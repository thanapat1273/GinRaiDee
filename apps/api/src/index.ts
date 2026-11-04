// Core API. Channel-agnostic: the local web app uses it now; a LINE adapter will later.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { dishById, matchDish } from "./catalog.ts";
import { parseGemini, geminiEnabled, rewordGemini } from "./chat/gemini.ts";
import { parseRules } from "./chat/rules.ts";
import { persona, reasonLine, suggestionText, type PersonaId } from "./chat/reply.ts";
import { ReasonEnum, type Intent } from "./chat/intent.ts";
import { buildContext } from "./context.ts";
import { one, query } from "./db.ts";
import { onAccept, onMeal, onOnboarding, onReject, onboardingDishes } from "./rank/learn.ts";
import { suggest, type Option, type Suggestion } from "./rank/select.ts";
import type { Constraints } from "./rank/score.ts";
import { findUrl, shopFromLink } from "./sources/links.ts";
import { importOsmAround } from "./sources/osm.ts";
import { importAround, placesEnabled } from "./sources/places.ts";
import { confirmShopDish, reportClosed, upsertShop } from "./sources/shops.ts";

const app = new Hono().basePath("/api");

async function me() {
  const u = await one<{ id: string; persona_id: PersonaId; onboarded_at: Date | null; diet: Record<string, unknown> }>(
    "SELECT id, persona_id, onboarded_at, diet FROM app_user ORDER BY created_at LIMIT 1");
  if (!u) throw new Error("no user: run npm run db:seed");
  return u;
}

const Loc = z.object({ lat: z.number().optional(), lng: z.number().optional() });

function view(o: Option, p: PersonaId) {
  return {
    slot: o.slot, kind: o.kind, reasons: o.reasons, reason: reasonLine(o, p),
    dish: { id: o.dish.id, th: o.dish.th, en: o.dish.en, kcal: o.dish.kcal, base: o.dish.base },
    shop: o.shop && { id: o.shop.id, name: o.shop.name, distanceM: o.shop.distanceM, mapsUrl: o.shop.mapsUrl, deliveryLinks: o.shop.deliveryLinks, price: o.shop.price },
    openNow: o.parts.openNow === 1 ? true : undefined,
  };
}

async function suggestionPayload(s: Suggestion, p: PersonaId, reroll = false) {
  let reply = suggestionText(s.options[0], p, reroll);
  if (geminiEnabled()) reply = await rewordGemini(reply, p);
  return { suggestionId: s.id, reply, options: s.options.map((o) => view(o, p)), context: s.context };
}

function constraintsFrom(i: Intent): Constraints {
  const c: Constraints = { want: i.constraints.want, base: i.constraints.base, maxPrice: i.constraints.maxPrice, kind: i.constraints.kind };
  const d = i.constraints.dishText ? matchDish(i.constraints.dishText) : undefined;
  if (d) c.dishIds = [d.id];
  return c;
}

app.get("/status", async (c) => {
  const u = await me();
  const counts = await one<Record<string, number>>(`SELECT
    (SELECT count(*)::int FROM dish) AS dishes, (SELECT count(*)::int FROM shop) AS shops,
    (SELECT count(*)::int FROM shop_dish) AS shop_dishes, (SELECT count(*)::int FROM meal_log) AS meals,
    (SELECT coalesce(max(n), 0)::int FROM user_model) AS learned`);
  return c.json({ gemini: geminiEnabled(), places: placesEnabled(), counts, user: { persona: u.persona_id, onboarded: !!u.onboarded_at, diet: u.diet } });
});

app.get("/onboarding", (c) =>
  c.json({ dishes: onboardingDishes(16).map((id) => { const d = dishById.get(id)!; return { id, th: d.th, en: d.en, base: d.base, kcal: d.kcal }; }) }));

app.post("/onboarding", async (c) => {
  const body = z.object({
    likes: z.array(z.string()).default([]), dislikes: z.array(z.string()).default([]),
    diet: z.object({ no: z.array(z.string()).optional(), halal: z.boolean().optional(), jay: z.boolean().optional(), vegetarian: z.boolean().optional() }).default({}),
  }).parse(await c.req.json());
  const u = await me();
  await query("UPDATE app_user SET diet = $2, onboarded_at = now() WHERE id = $1", [u.id, body.diet]);
  await onOnboarding(u.id, body.likes, body.dislikes);
  return c.json({ ok: true });
});

app.put("/me", async (c) => {
  const body = z.object({ persona: z.enum(["phuean", "suphap"]).optional() }).parse(await c.req.json());
  const u = await me();
  if (body.persona) await query("UPDATE app_user SET persona_id = $2 WHERE id = $1", [u.id, body.persona]);
  return c.json({ ok: true });
});

app.post("/suggest", async (c) => {
  const body = Loc.extend({ constraints: z.custom<Constraints>().optional() }).parse(await c.req.json());
  const u = await me();
  const ctx = await buildContext(body.lat, body.lng);
  return c.json(await suggestionPayload(await suggest(u.id, ctx, body.constraints ?? {}), u.persona_id));
});

app.post("/feedback", async (c) => {
  const body = Loc.extend({
    suggestionId: z.string().uuid(), dishId: z.string(), shopId: z.string().uuid().optional(),
    action: z.enum(["accept", "reject"]), reason: ReasonEnum.optional(),
  }).parse(await c.req.json());
  const u = await me();
  await query(
    "INSERT INTO feedback (suggestion_id, user_id, dish_id, shop_id, action, reason) VALUES ($1, $2, $3, $4, $5, $6)",
    [body.suggestionId, u.id, body.dishId, body.shopId ?? null, body.action, body.reason ?? null]);
  if (body.action === "accept") {
    await onAccept(u.id, body.dishId, body.suggestionId);
    const d = dishById.get(body.dishId)!;
    await query(
      "INSERT INTO meal_log (user_id, dish_id, dish_text, origin, shop_id, via, confirmed) VALUES ($1, $2, $3, $4, $5, 'accept', false)",
      [u.id, d.id, d.th, body.shopId ? "place" : "other", body.shopId ?? null]);
    if (body.shopId) await confirmShopDish(body.shopId, d.id);
    return c.json({ ok: true, reply: persona(u.persona_id).logged(d.th) });
  }
  await onReject(u.id, body.dishId, body.reason, body.suggestionId);
  const ctx = await buildContext(body.lat, body.lng);
  return c.json(await suggestionPayload(await suggest(u.id, ctx, {}), u.persona_id, true));
});

app.post("/chat", async (c) => {
  const body = Loc.extend({ message: z.string().min(1).max(500), lastSuggestionId: z.string().uuid().optional() }).parse(await c.req.json());
  const u = await me();
  const p = persona(u.persona_id);
  const url = findUrl(body.message);
  const intent = (await parseGemini(body.message)) ?? parseRules(body.message);
  const ctx = await buildContext(body.lat, body.lng);

  if (intent.intent === "persona" && intent.persona) {
    await query("UPDATE app_user SET persona_id = $2 WHERE id = $1", [u.id, intent.persona]);
    return c.json({ intent: "persona", reply: persona(intent.persona).persona });
  }
  if (intent.intent === "reject" && body.lastSuggestionId) {
    const head = await one<{ dish_id: string }>(
      "SELECT items->0->>'dish_id' AS dish_id FROM suggestion WHERE id = $1 AND user_id = $2", [body.lastSuggestionId, u.id]);
    await query("INSERT INTO feedback (suggestion_id, user_id, dish_id, action, reason) VALUES ($1, $2, $3, 'reject', $4)",
      [body.lastSuggestionId, u.id, head?.dish_id ?? null, intent.reason ?? "other"]);
    await onReject(u.id, head?.dish_id, intent.reason, body.lastSuggestionId);
    return c.json({ intent: "suggest", ...(await suggestionPayload(await suggest(u.id, ctx, constraintsFrom(intent)), u.persona_id, true)) });
  }
  if (intent.intent === "log" && intent.log) {
    const d = matchDish(intent.log.dishText);
    const name = d?.th ?? intent.log.dishText;
    // ask where it came from, unless the message already says (or carries a link)
    const origin = url ? (/(maps|goo\.gl)/.test(url) ? "place" : "delivery") : intent.log.origin;
    if (!origin) return c.json({ intent: "log", needs: "origin", dishText: intent.log.dishText, dishId: d?.id, reply: p.askOrigin(name) });
    if ((origin === "place" || origin === "delivery") && !url) {
      return c.json({ intent: "log", needs: "link", origin, dishText: intent.log.dishText, dishId: d?.id, reply: p.askLink[origin] });
    }
    return c.json({ intent: "log", ...(await logMeal(u.id, u.persona_id, { dishText: intent.log.dishText, origin, link: url, via: "chat", lat: body.lat, lng: body.lng })) });
  }
  if (intent.intent === "suggest") {
    return c.json({ intent: "suggest", ...(await suggestionPayload(await suggest(u.id, ctx, constraintsFrom(intent)), u.persona_id)) });
  }
  return c.json({ intent: intent.intent, reply: intent.intent === "help" ? p.help : p.chat });
});

const LogBody = Loc.extend({
  dishText: z.string().min(1), dishId: z.string().optional(),
  origin: z.enum(["place", "delivery", "homemade", "other"]),
  link: z.string().url().optional(), shopName: z.string().optional(),
  via: z.enum(["chat", "form", "photo", "checkin"]).default("form"),
});

async function logMeal(userId: string, personaId: PersonaId, b: z.infer<typeof LogBody>) {
  const p = persona(personaId);
  const d = (b.dishId ? dishById.get(b.dishId) : undefined) ?? matchDish(b.dishText);
  let shopId: string | undefined, shopName: string | undefined;
  if (b.link) {
    const r = await shopFromLink(b.link, { name: b.shopName, lat: b.lat, lng: b.lng });
    if (r.needsName) return { needs: "shopName", origin: b.origin, dishText: b.dishText, dishId: d?.id, link: b.link, reply: "ขอชื่อร้านด้วย จะได้จำไว้" };
    shopId = r.shopId; shopName = r.shopName;
  } else if (b.shopName && b.origin === "place") {
    const r = await upsertShop({ name: b.shopName, lat: b.lat, lng: b.lng, source: "user" });
    shopId = r.id; shopName = b.shopName;
  }
  if (shopId && d) await confirmShopDish(shopId, d.id);
  const ctx = await buildContext(b.lat, b.lng);
  await query(
    "INSERT INTO meal_log (user_id, dish_id, dish_text, origin, shop_id, link, via, confirmed) VALUES ($1, $2, $3, $4, $5, $6, $7, true)",
    [userId, d?.id ?? null, b.dishText, b.origin, shopId ?? null, b.link ?? null, b.via]);
  if (d) await onMeal(userId, d.id, false, ctx);
  const reply = d ? p.logged(d.th) + (shopName ? ` @ ${shopName}` : "") : p.unknownDish(b.dishText);
  return { logged: true, dishId: d?.id, shopName, reply };
}

app.post("/log", async (c) => {
  const b = LogBody.parse(await c.req.json());
  const u = await me();
  return c.json(await logMeal(u.id, u.persona_id, b));
});

app.get("/history", async (c) => {
  const u = await me();
  return c.json({ meals: await query(
    `SELECT m.id, m.dish_text, d.name_th, m.origin, s.name AS shop_name, m.via, m.confirmed, m.eaten_at
     FROM meal_log m LEFT JOIN dish d ON d.id = m.dish_id LEFT JOIN shop s ON s.id = m.shop_id
     WHERE m.user_id = $1 ORDER BY m.eaten_at DESC LIMIT 30`, [u.id]) });
});

app.post("/shops/import", async (c) => {
  const b = z.object({ lat: z.number(), lng: z.number(), radius: z.number().min(100).max(3000).default(800), source: z.enum(["places", "osm"]) }).parse(await c.req.json());
  if (b.source === "places" && !placesEnabled()) return c.json({ error: "GOOGLE_PLACES_API_KEY is not set" }, 400);
  const res = b.source === "places" ? await importAround(b.lat, b.lng, b.radius) : await importOsmAround(b.lat, b.lng, b.radius);
  return c.json({ source: b.source, ...res });
});

app.post("/shops/:id/closed", async (c) => {
  await reportClosed(c.req.param("id"));
  return c.json({ ok: true });
});

app.onError((err, c) => {
  if (err instanceof z.ZodError) return c.json({ error: "bad request", issues: err.issues }, 400);
  console.error(err);
  return c.json({ error: err.message }, 500);
});

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => console.log(`api on http://127.0.0.1:${port}`));
