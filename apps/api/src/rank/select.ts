// The cascade: hard rules → critiques → score (learned θ̃·φ + named terms) → availability →
// slate. Slate = headline (Thompson draw) + varied alternative (MMR) + lighter swap + explore slot.
// Every item is logged with its features and the probability it was shown. Design: docs/design/02-recommender.md
import { attrVector, dishById, dishes, type Dish } from "../catalog.ts";
import type { Context } from "../context.ts";
import { one, query } from "../db.ts";
import { openNow } from "../sources/places.ts";
import { FEATURES, phi } from "./features.ts";
import { dot } from "./linalg.ts";
import { loadModel } from "./model.ts";
import { allowed, applyCritiques, extraTerms, type Constraints, type ScoreParts, type UserState } from "./score.ts";
import { loadUserState } from "./state.ts";

export const POLICY = "lints-v1+slate-v1";
const TOP_DISHES = 20;
const DRAWS = 200;          // posterior draws used to estimate the headline's probability
const MMR_LAMBDA = 0.6;     // 1 = pure score, 0 = pure diversity

export type OptionKind = "walkin" | "delivery" | "seven" | "cook" | "idea";
export type Slot = "headline" | "alt" | "lighter" | "explore";

export interface ShopRef {
  id: string; name: string; distanceM?: number; mapsUrl?: string;
  deliveryLinks: Record<string, string>; price?: number; confidence: number; googlePlaceId?: string;
}

export interface Option {
  dish: Dish; kind: OptionKind; shop?: ShopRef; slot: Slot;
  score: number;            // with the posterior mean
  sampled: number;          // with this request's Thompson draw
  parts: ScoreParts; phi: number[]; propensity?: number; reasons: string[];
}

interface ShopRow {
  dish_id: string; id: string; name: string; kind: string; maps_url: string | null; google_place_id: string | null;
  delivery_links: Record<string, string>; confidence: number; price: number | null; dist: number | null;
}

async function shopsFor(dishIds: string[], ctx: Context, radiusM: number): Promise<ShopRow[]> {
  const loc = ctx.lat !== undefined && ctx.lng !== undefined;
  return query<ShopRow>(
    `SELECT sd.dish_id, s.id, s.name, s.kind, s.maps_url, s.google_place_id, s.delivery_links, sd.confidence, sd.price,
            CASE WHEN $2::float8 IS NULL OR s.geom IS NULL THEN NULL
                 ELSE ST_Distance(s.geom, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography) END AS dist
     FROM shop_dish sd JOIN shop s ON s.id = sd.shop_id
     WHERE sd.dish_id = ANY($1)
       AND coalesce(s.business_status, 'OPERATIONAL') NOT IN ('CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY')
       AND ( s.delivery_links <> '{}'::jsonb
             OR ($2::float8 IS NOT NULL AND s.geom IS NOT NULL
                 AND ST_DWithin(s.geom, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4)) )`,
    [dishIds, loc ? ctx.lat : null, loc ? ctx.lng : null, radiusM]);
}

const toShop = (r: ShopRow): ShopRef => ({
  id: r.id, name: r.name, distanceM: r.dist === null ? undefined : Math.round(r.dist), mapsUrl: r.maps_url ?? undefined,
  deliveryLinks: r.delivery_links ?? {}, price: r.price ?? undefined, confidence: r.confidence,
  googlePlaceId: r.google_place_id ?? undefined,
});

export function similarity(a: Dish, b: Dish): number {
  const va = attrVector(a), vb = attrVector(b);
  const cos = dot(va, vb) / ((Math.hypot(...va) * Math.hypot(...vb)) || 1);
  const family = a.id === b.id || a.parent === b.id || b.parent === a.id || (a.parent !== undefined && a.parent === b.parent) ? 0.5 : 0;
  return Math.min(1, 0.6 * cos + (a.base === b.base ? 0.2 : 0) + family);
}

const richness = (d: Dish) => (d.attrs.fatty + d.attrs.heavy) / 2;

function contribution(mean: number[], phiVec: number[], names: string[]) {
  return names.reduce((s, n) => { const i = FEATURES.indexOf(n as (typeof FEATURES)[number]); return s + (mean[i] ?? 0) * (phiVec[i] ?? 0); }, 0);
}

function reasonsFor(o: Option, ctx: Context, u: UserState, mean: number[]): string[] {
  const r: string[] = [];
  if (ctx.weather?.raining && contribution(mean, o.phi, ["soupy×rain", "hot_dish×rain"]) > 0.1) r.push("rain");
  if (ctx.weather && ctx.weather.tempC >= 33 && contribution(mean, o.phi, ["cold_dish×heat", "sour×heat", "heavy×heat"]) > 0.1) r.push("heat");
  if ((o.parts.constraint ?? 0) > 0.3) r.push("asked");
  if (o.slot === "lighter") r.push("light");
  if (o.slot === "explore") r.push("explore");
  if ((o.parts.favourite ?? 0) > 0.1) r.push("favourite");
  if ((o.parts.novelty ?? 0) > 0) r.push("new");
  if (o.slot === "headline" && u.recentRejects.some((x) => x.reason && ctx.now.getTime() - x.at.getTime() < 3 * 3_600_000)) r.push("mood");
  if (o.kind === "walkin" && (o.shop?.distanceM ?? 9999) < 400) r.push("near");
  if (o.kind === "delivery") r.push("delivery");
  if (o.kind === "seven" || o.kind === "cook") r.push("fallback");
  if (ctx.slot === "breakfast" && o.dish.meals.includes("breakfast")) r.push("breakfast");
  if (ctx.slot === "late") r.push("late");
  return [...new Set(r)];
}

export interface Suggestion { id: string; options: Option[]; context: Record<string, unknown> }

export async function suggest(userId: string, ctx: Context, c: Constraints = {}, radiusM = 1500): Promise<Suggestion> {
  const [u, model] = await Promise.all([loadUserState(userId), loadModel(userId)]);
  const now = ctx.now;
  const tooFar = u.recentRejects.some((r) => r.reason === "too_far" && now.getTime() - r.at.getTime() < 3 * 3_600_000);
  const radius = tooFar ? Math.round(radiusM * 0.5) : radiusM;

  // 1–2. hard rules, then session critiques (relaxed if too strict)
  const crit = applyCritiques(dishes.filter((d) => allowed(d, u, c, now)), u, dishById, now);

  // 3. score: learned θ·φ plus named terms
  const { mean, thetas } = model.draw(DRAWS);
  const scored = crit.dishes.map((d) => {
    const f = phi(d, ctx);
    const parts = extraTerms(d, ctx, u, c);
    if (crit.relaxed) parts.critique = crit.penalty(d);
    const extra = Object.values(parts).reduce((s, v) => s + v, 0);
    return { d, f, parts, extra, meanScore: dot(mean, f) + extra };
  }).sort((a, b) => b.meanScore - a.meanScore).slice(0, TOP_DISHES);

  // 4. availability: dish → concrete options
  const rows = await shopsFor(scored.map((s) => s.d.id), ctx, radius);
  const byDish = new Map<string, ShopRow[]>();
  for (const r of rows) byDish.set(r.dish_id, [...(byDish.get(r.dish_id) ?? []), r]);
  const options: Option[] = [];
  for (const s of scored) {
    const shops = byDish.get(s.d.id) ?? [];
    const walk = shops.filter((r) => r.dist !== null && r.kind !== "convenience")
      .map((r) => ({ r, v: r.confidence * 0.35 - (r.dist! / radius) * (tooFar ? 0.6 : 0.3) - (c.maxPrice && r.price && r.price > c.maxPrice ? 1 : 0) }))
      .sort((a, b) => b.v - a.v)[0];
    const del = shops.filter((r) => Object.keys(r.delivery_links ?? {}).length > 0).sort((a, b) => b.confidence - a.confidence)[0];
    const seven = shops.filter((r) => r.kind === "convenience" && r.dist !== null).sort((a, b) => a.dist! - b.dist!)[0];
    const push = (kind: OptionKind, avail: number, shop?: ShopRow) => {
      if (c.kind && c.kind !== kind) return;
      options.push({ dish: s.d, kind, shop: shop && toShop(shop), slot: "alt", score: s.meanScore + avail, sampled: 0,
        parts: { model: dot(mean, s.f), ...s.parts, availability: avail }, phi: s.f, reasons: [] });
    };
    if (s.d.tags.includes("seven")) push("seven", ctx.slot === "late" ? 0.1 : -0.15, seven);
    else if (s.d.tags.includes("cook")) push("cook", ctx.slot === "late" ? 0 : -0.3);
    else {
      if (walk) push("walkin", walk.v, walk.r);
      if (del) push("delivery", del.confidence * 0.15 + (tooFar ? 0.2 : 0), del);
      if (!walk && !del) push("idea", -0.25);
    }
  }
  if (!options.length) return { id: "", options: [], context: { slot: ctx.slot, empty: true } };

  // 5. headline = argmax under this request's Thompson draw; its probability ≈ share of draws it wins
  const sampledScore = (o: Option, theta: number[]) => dot(theta, o.phi) + (o.score - o.parts.model!);
  const wins = new Map<Option, number>();
  for (const theta of thetas) {
    let best = options[0]!, bestV = -Infinity;
    for (const o of options) { const v = sampledScore(o, theta); if (v > bestV) { bestV = v; best = o; } }
    wins.set(best, (wins.get(best) ?? 0) + 1);
  }
  for (const o of options) o.sampled = sampledScore(o, thetas[0]!);
  const ranked = [...options].sort((a, b) => b.sampled - a.sampled);

  // open-now check for a walk-in headline (Enterprise field, only when a Places key is set)
  let head = ranked[0]!;
  for (const cand of ranked.slice(0, 3)) {
    if (cand.kind !== "walkin" || !cand.shop?.googlePlaceId) { head = cand; break; }
    const open = await openNow(cand.shop.googlePlaceId);
    if (open !== false) { head = cand; if (open) cand.parts.openNow = 1; break; }
  }
  const chosen: Option[] = [{ ...head, slot: "headline", propensity: (wins.get(head) ?? 0) / DRAWS }];
  const rest = () => options.filter((o) => !chosen.some((x) => x.dish.id === o.dish.id));

  // 6a. a varied alternative (MMR)
  const mmr = (pool: Option[]) => pool
    .map((o) => ({ o, v: MMR_LAMBDA * o.score - (1 - MMR_LAMBDA) * Math.max(...chosen.map((x) => similarity(o.dish, x.dish))) + (chosen.every((x) => x.kind !== o.kind) ? 0.1 : 0) }))
    .sort((a, b) => b.v - a.v)[0]?.o;
  const alt = mmr(rest());
  if (alt) chosen.push({ ...alt, slot: "alt" });

  // 6b. a comparable but lighter swap after a rich headline (Elsweiler et al.: pairing nudges, filters don't)
  if (richness(head.dish) > 0.55) {
    const lighter = rest()
      .filter((o) => similarity(o.dish, head.dish) >= 0.45 && richness(o.dish) <= richness(head.dish) - 0.2 && o.dish.attrs.clean >= head.dish.attrs.clean)
      .sort((a, b) => b.score - a.score)[0];
    if (lighter) chosen.push({ ...lighter, slot: "lighter" });
  }

  // 6c. explore slot: uniform over the remaining pool, so its probability is exactly 1/|pool|
  const pool = rest();
  if (pool.length) {
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    chosen.push({ ...pick, slot: "explore", propensity: 1 / pool.length });
  }
  while (chosen.length < 4) { const o = mmr(rest()); if (!o) break; chosen.push({ ...o, slot: "alt" }); }
  for (const o of chosen) o.reasons = reasonsFor(o, ctx, u, mean);

  const context = {
    slot: ctx.slot, hour: ctx.hour, weather: ctx.weather ?? null, located: ctx.lat !== undefined, radius,
    constraints: c, critiquesRelaxed: crit.relaxed, modelN: model.n,
    sessionReasons: u.recentRejects.filter((r) => r.reason && now.getTime() - r.at.getTime() < 3 * 3_600_000).map((r) => r.reason),
  };
  const row = await one<{ id: string }>(
    "INSERT INTO suggestion (user_id, context, items, policy) VALUES ($1, $2, $3, $4) RETURNING id",
    // node-postgres sends JS arrays as Postgres arrays, so jsonb arrays must be stringified
    [userId, context, JSON.stringify(chosen.map((o, rank) => ({
      rank, slot: o.slot, dish_id: o.dish.id, shop_id: o.shop?.id ?? null, kind: o.kind,
      score: Number(o.score.toFixed(4)), propensity: o.propensity ?? null, phi: o.phi,
      parts: Object.fromEntries(Object.entries(o.parts).map(([k, v]) => [k, Number(v.toFixed(4))])),
    }))), POLICY]);
  return { id: row!.id, options: chosen, context };
}
