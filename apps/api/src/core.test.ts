import assert from "node:assert/strict";
import { test } from "node:test";
import { dishById, matchDish } from "./catalog.ts";
import { parseRules } from "./chat/rules.ts";
import { DIM, FEATURES, phi, priorVector } from "./rank/features.ts";
import { onboardingDishes } from "./rank/learn.ts";
import { LinTS } from "./rank/model.ts";
import { applyCritiques, type UserState } from "./rank/score.ts";
import { nameSimilarity } from "./sources/shops.ts";
import { parseMapsUrl, classifyLink } from "./sources/links.ts";

test("rules parser: intents and constraints", () => {
  assert.equal(parseRules("กินอะไรดี").intent, "suggest");
  const c = parseRules("อยากกินเผ็ดๆ ไม่เกิน 100 แถวอโศก");
  assert.equal(c.intent, "suggest");
  assert.equal(c.constraints.want?.spicy, 1);
  assert.equal(c.constraints.maxPrice, 100);
  assert.equal(parseRules("ไม่เผ็ดนะ").constraints.want?.spicy, -1);
  assert.deepEqual([parseRules("มันไป").intent, parseRules("มันไป").reason], ["reject", "too_fatty"]);
  assert.equal(parseRules("เพิ่งกินเมื่อวาน").reason, "ate_recently");
  const log = parseRules("เมื่อกี้กินส้มตำไป");
  assert.equal(log.intent, "log");
  assert.equal(log.log?.dishText, "ส้มตำ");
  assert.equal(parseRules("พูดสุภาพหน่อย").persona, "suphap");
  assert.equal(parseRules("สั่งอะไรดี เดลิเวอรี่").constraints.kind, "delivery");
});

test("dish matching prefers the longest alias", () => {
  assert.equal(matchDish("ข้าวมันไก่ทอด")?.id, "khao-man-gai-tod");
  assert.equal(matchDish("ข้าวมันไก่")?.id, "khao-man-gai");
  assert.equal(matchDish("กระเพราหมูกรอบไข่ดาว")?.id, "kaprao-moo-krob");
  assert.equal(matchDish("pad thai")?.id, "pad-thai");
});

test("LinTS starts at the prior and learns toward rewards", () => {
  const m = LinTS.fresh();
  const { mean } = m.draw(1);
  priorVector().forEach((p, i) => assert.ok(Math.abs(mean[i]! - p) < 1e-9, String(FEATURES[i])));
  const d = dishById.get("som-tam-thai")!;
  const f = phi(d, { slot: "lunch", weather: undefined });
  const before = f.reduce((s, x, i) => s + x * mean[i]!, 0);
  for (let i = 0; i < 5; i++) m.update(f, 1);
  const after = f.reduce((s, x, i) => s + x * m.draw(1).mean[i]!, 0);
  assert.ok(after > before, "accepting a dish raises its predicted reward");
  assert.equal(f.length, DIM);
});

test("critique filter: 'too fatty' on ข้าวขาหมู keeps only leaner dishes, relaxes when too strict", () => {
  const ref = dishById.get("khao-kha-moo")!;
  const u: UserState = { diet: {}, favourites: new Map(), recentMeals: [], impressions: new Map(),
    recentRejects: [{ dishId: ref.id, reason: "too_fatty", at: new Date() }] };
  const all = [...dishById.values()];
  const r = applyCritiques(all, u, dishById, new Date());
  assert.equal(r.relaxed, false);
  assert.ok(r.dishes.every((d) => d.attrs.fatty <= ref.attrs.fatty - 0.15));
  const tiny = applyCritiques([ref, dishById.get("mookata")!], u, dishById, new Date());
  assert.equal(tiny.relaxed, true);
  assert.ok(tiny.penalty(dishById.get("mookata")!) < 0);
});

test("onboarding grid: 16 distinct, varied dishes", () => {
  const ids = onboardingDishes(16);
  assert.equal(new Set(ids).size, 16);
  const bases = new Set(ids.map((id) => dishById.get(id)!.base));
  assert.ok(bases.size >= 3, `covers several bases, got ${[...bases]}`);
});

test("shop name similarity and Google Maps links", () => {
  assert.ok(nameSimilarity("ร้านข้าวมันไก่ป้าแดง", "ข้าวมันไก่ป้าแดง") >= 0.85);
  assert.ok(nameSimilarity("Cafe Amazon", "ร้านโจ๊ก") < 0.5);
  const p = parseMapsUrl("https://www.google.com/maps/place/%E0%B8%82%E0%B9%89%E0%B8%B2%E0%B8%A7/@13.7373,100.5603,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d13.7375!4d100.5610");
  assert.equal(p.lat, 13.7375);
  assert.equal(p.lng, 100.561);
  assert.equal(classifyLink("https://maps.app.goo.gl/abc123"), "google_maps");
  assert.equal(classifyLink("https://food.grab.com/th/en/restaurant/x"), "grab");
  assert.equal(classifyLink("https://lineman.line.me/food/r/123"), "lineman");
});
