// OpenStreetMap via Overpass: free and storable (ODbL), so it is the stored baseline.
// The public server is sometimes slow; set OVERPASS_URL to a mirror, or use a Geofabrik
// extract for city-wide batches (docs/design/01-data-gathering.md).
import { addDishGuesses, upsertShop } from "./shops.ts";

const MIRRORS = () => (process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
]);

async function overpass(q: string): Promise<{ elements: El[] }> {
  const errors: string[] = [];
  for (const url of MIRRORS()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "GinRaiDee/0.1 (personal project)" },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return (await res.json()) as { elements: El[] };
      errors.push(`${new URL(url).host} ${res.status}`);
    } catch (err) {
      errors.push(`${new URL(url).host} ${(err as Error).name}`);
    }
  }
  throw new Error(`all Overpass mirrors failed (${errors.join(", ")}); try again later or set OVERPASS_URL`);
}

interface El { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

export async function importOsmAround(lat: number, lng: number, radius = 800) {
  const q = `[out:json][timeout:25];
(
  nwr["amenity"~"^(restaurant|fast_food|food_court|cafe)$"](around:${radius},${lat},${lng});
  nwr["shop"="convenience"](around:${radius},${lat},${lng});
);
out center tags;`;
  const j = await overpass(q);
  let created = 0, merged = 0, skipped = 0;
  for (const e of j.elements) {
    const t = e.tags ?? {};
    const name = t["name:th"] ?? t.name ?? t.brand ?? t["name:en"];
    const p = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : undefined);
    if (!name || !p) { skipped++; continue; }
    const types = [t.amenity, t.shop === "convenience" ? "convenience_store" : undefined, ...(t.cuisine?.split(";").map((c) => `${c.trim()}_restaurant`) ?? [])]
      .filter((x): x is string => !!x);
    const r = await upsertShop({ name, lat: p.lat, lng: p.lon, osmId: `${e.type}/${e.id}`, types, source: "osm" });
    // cuisine words ("noodle", "thai;seafood") help the dish guesser too
    if (t.cuisine) await addDishGuesses(r.id, `${name} ${t.cuisine.replace(/[;_]/g, " ")}`, types);
    r.created ? created++ : merged++;
  }
  return { found: j.elements.length, created, merged, skipped };
}
