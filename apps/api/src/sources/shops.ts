// Shared shop writes: upsert from any source, cross-source dedupe, and dish guesses.
import { guessShopDishes } from "../catalog.ts";
import { one, query } from "../db.ts";

export interface ShopInput {
  name: string;
  lat?: number;
  lng?: number;
  googlePlaceId?: string;
  osmId?: string;
  kind?: string;
  types?: string[];
  businessStatus?: string;
  mapsUrl?: string;
  deliveryLinks?: Record<string, string>;
  source: "places" | "osm" | "user" | "link";
}

/** Thai/English shop names vary in spacing, prefixes and punctuation; compare a stripped key. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/^(ร้าน|ครัว)\s*/u, "")
    .replace(/[\s\-_.,'"()&/]+/g, "");
}

/** Similarity of two name keys in 0..1 (normalised Levenshtein). */
export function nameSimilarity(a: string, b: string): number {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return 0;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const dp = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - dp[y.length]! / Math.max(x.length, y.length);
}

/**
 * Insert or merge a shop. Match order: same source id → same name within 60 m (100 m for
 * named chains is too loose, so chains match on distance only within 30 m).
 */
export async function upsertShop(s: ShopInput): Promise<{ id: string; created: boolean }> {
  const byId = s.googlePlaceId
    ? await one<{ id: string }>("SELECT id FROM shop WHERE google_place_id = $1", [s.googlePlaceId])
    : s.osmId ? await one<{ id: string }>("SELECT id FROM shop WHERE osm_id = $1", [s.osmId]) : undefined;

  let matchId = byId?.id;
  if (!matchId && s.lat !== undefined && s.lng !== undefined) {
    const near = await query<{ id: string; name: string; dist: number }>(
      `SELECT id, name, ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS dist
       FROM shop WHERE geom IS NOT NULL AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, 60)
       ORDER BY dist LIMIT 5`, [s.lat, s.lng]);
    const isChain = /7-?eleven|เซเว่น|lotus|family ?mart|café amazon/i.test(s.name);
    matchId = near.find((n) => isChain ? n.dist < 30 && nameSimilarity(n.name, s.name) > 0.5 : nameSimilarity(n.name, s.name) >= 0.85)?.id;
  }

  const geom = s.lat !== undefined && s.lng !== undefined ? `SRID=4326;POINT(${s.lng} ${s.lat})` : null;
  const kind = s.kind ?? kindFrom(s.name, s.types ?? []);
  if (matchId) {
    await query(
      `UPDATE shop SET
         google_place_id = coalesce(google_place_id, $2), osm_id = coalesce(osm_id, $3),
         geom = coalesce(geom, $4::geography), business_status = coalesce($5, business_status),
         maps_url = coalesce(maps_url, $6), delivery_links = delivery_links || $7::jsonb,
         google_cached_at = CASE WHEN $2::text IS NOT NULL THEN now() ELSE google_cached_at END,
         last_seen = now()
       WHERE id = $1`,
      [matchId, s.googlePlaceId ?? null, s.osmId ?? null, geom, s.businessStatus ?? null, s.mapsUrl ?? null, s.deliveryLinks ?? {}]);
    await addDishGuesses(matchId, s.name, s.types ?? []);
    return { id: matchId, created: false };
  }
  const row = await one<{ id: string }>(
    `INSERT INTO shop (name, geom, google_place_id, osm_id, kind, business_status, maps_url, delivery_links, source, google_cached_at)
     VALUES ($1, $2::geography, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $3::text IS NOT NULL THEN now() END) RETURNING id`,
    [s.name, geom, s.googlePlaceId ?? null, s.osmId ?? null, kind, s.businessStatus ?? null, s.mapsUrl ?? null, s.deliveryLinks ?? {}, s.source]);
  await addDishGuesses(row!.id, s.name, s.types ?? []);
  return { id: row!.id, created: true };
}

function kindFrom(name: string, types: string[]): string {
  if (/7-?eleven|เซเว่น|family ?mart|lotus'?s? go/i.test(name) || types.includes("convenience_store")) return "convenience";
  if (types.includes("food_court")) return "food_court";
  if (types.includes("cafe") || types.includes("coffee_shop")) return "cafe";
  return "restaurant";
}

export async function addDishGuesses(shopId: string, name: string, types: string[]) {
  for (const [dishId, conf] of guessShopDishes(name, types)) {
    await query(
      `INSERT INTO shop_dish (shop_id, dish_id, confidence, source) VALUES ($1, $2, $3, 'name_match')
       ON CONFLICT (shop_id, dish_id) DO UPDATE SET confidence = greatest(shop_dish.confidence, $3)`,
      [shopId, dishId, conf]);
  }
}

/** Strong evidence: the user ate this dish here, or said so. */
export async function confirmShopDish(shopId: string, dishId: string, price?: number) {
  await query(
    `INSERT INTO shop_dish (shop_id, dish_id, confidence, source, price) VALUES ($1, $2, 0.95, 'log', $3)
     ON CONFLICT (shop_id, dish_id) DO UPDATE SET confidence = 0.95, source = 'log',
       price = coalesce($3, shop_dish.price), last_seen = now()`,
    [shopId, dishId, price ?? null]);
}

export async function reportClosed(shopId: string) {
  await query("UPDATE shop SET business_status = 'CLOSED_PERMANENTLY', last_seen = now() WHERE id = $1", [shopId]);
}
