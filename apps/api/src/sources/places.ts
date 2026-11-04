// Google Places API (New). Only place IDs may be stored indefinitely; names and coordinates
// we keep are a cache stamped with google_cached_at and must be refreshed within 30 days.
// Field masks stay at the Pro tier for sweeps; Enterprise fields (hours) are fetched lazily.
import { upsertShop } from "./shops.ts";

const KEY = () => process.env.GOOGLE_PLACES_API_KEY ?? "";
export const placesEnabled = () => KEY().length > 0;

const FOOD_TYPES = [
  "restaurant", "thai_restaurant", "food_court", "meal_takeaway", "fast_food_restaurant", "cafe",
  "noodle_shop", "chinese_noodle_restaurant", "soup_restaurant", "hot_pot_restaurant", "chicken_restaurant",
  "halal_restaurant", "breakfast_restaurant", "seafood_restaurant", "barbecue_restaurant", "japanese_restaurant",
  "ramen_restaurant", "vegetarian_restaurant", "dessert_shop", "snack_bar",
];
const PRO_MASK = "places.id,places.displayName,places.location,places.types,places.primaryType,places.businessStatus,places.googleMapsUri";

interface Place {
  id: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  types?: string[];
  businessStatus?: string;
  googleMapsUri?: string;
}

async function post(path: string, body: unknown, mask: string): Promise<{ places?: Place[] }> {
  const res = await fetch(`https://places.googleapis.com/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY(), "X-Goog-FieldMask": mask },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Places ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<{ places?: Place[] }>;
}

async function nearby(lat: number, lng: number, radius: number, types: string[]): Promise<Place[]> {
  const j = await post("places:searchNearby", {
    includedTypes: types, maxResultCount: 20, rankPreference: "DISTANCE", languageCode: "th",
    locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
  }, PRO_MASK);
  return j.places ?? [];
}

/**
 * Sweep a circle. Nearby Search returns at most 20 places with no paging, so a full cell
 * is split into 4 smaller circles (a quadtree), down to 150 m. maxCalls caps the spend.
 */
export async function importAround(lat: number, lng: number, radius = 600, maxCalls = 25) {
  const seen = new Set<string>();
  let calls = 0, created = 0, merged = 0;
  const queue: { lat: number; lng: number; r: number }[] = [{ lat, lng, r: radius }];
  while (queue.length && calls < maxCalls) {
    const cell = queue.shift()!;
    calls++;
    const places = await nearby(cell.lat, cell.lng, cell.r, FOOD_TYPES);
    for (const p of places) {
      if (seen.has(p.id) || !p.displayName || !p.location) continue;
      seen.add(p.id);
      const res = await upsertShop({
        name: p.displayName.text, lat: p.location.latitude, lng: p.location.longitude,
        googlePlaceId: p.id, types: p.types, businessStatus: p.businessStatus, mapsUrl: p.googleMapsUri, source: "places",
      });
      res.created ? created++ : merged++;
    }
    if (places.length >= 20 && cell.r > 150) {
      const d = cell.r / 2, dLat = d / 111_320, dLng = d / (111_320 * Math.cos((cell.lat * Math.PI) / 180));
      for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        queue.push({ lat: cell.lat + a * dLat, lng: cell.lng + b * dLng, r: d * 1.15 });
      }
    }
  }
  return { calls, found: seen.size, created, merged, truncated: queue.length > 0 };
}

/** Resolve a name (from a Google Maps link) near a point to a place. Text Search, Pro tier. */
export async function findPlace(text: string, lat?: number, lng?: number): Promise<Place | undefined> {
  const body: Record<string, unknown> = { textQuery: text, pageSize: 1, languageCode: "th" };
  if (lat !== undefined && lng !== undefined) body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 300 } };
  const j = await post("places:searchText", body, PRO_MASK);
  return j.places?.[0];
}

// Open-now is an Enterprise field: only fetched for a shop we are about to recommend, cached 30 min.
const openCache = new Map<string, { at: number; open: boolean | undefined }>();
export async function openNow(placeId: string): Promise<boolean | undefined> {
  if (!placesEnabled()) return undefined;
  const hit = openCache.get(placeId);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.open;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: { "X-Goog-Api-Key": KEY(), "X-Goog-FieldMask": "currentOpeningHours.openNow,businessStatus" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { currentOpeningHours?: { openNow?: boolean }; businessStatus?: string };
    const open = j.businessStatus && j.businessStatus !== "OPERATIONAL" ? false : j.currentOpeningHours?.openNow;
    openCache.set(placeId, { at: Date.now(), open });
    return open;
  } catch {
    return undefined;
  }
}
