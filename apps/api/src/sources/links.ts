// Links the user pastes when logging a meal: Google Maps pins and delivery-app shares.
// We store the link and the facts we can read from it, never the page content.
import { one } from "../db.ts";
import { findPlace, placesEnabled } from "./places.ts";
import { upsertShop } from "./shops.ts";

export type LinkKind = "google_maps" | "grab" | "lineman" | "shopeefood" | "robinhood" | "other";

export function classifyLink(url: string): LinkKind {
  const h = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
  if (/(^|\.)maps\.app\.goo\.gl$|(^|\.)goo\.gl$|(^|\.)google\.[a-z.]+$/.test(h) && /maps|goo\.gl/.test(url)) return "google_maps";
  if (/(^|\.)grab\.com$|^r\.grab\.com$/.test(h)) return "grab";
  if (/(^|\.)lineman\.line\.me$|(^|\.)wongnai\.com$|^lin\.ee$/.test(h)) return "lineman";
  if (/(^|\.)shopee\.co\.th$|(^|\.)shopeefood\.co\.th$|^s\.shopee\.co\.th$/.test(h)) return "shopeefood";
  if (/robinhood/.test(h)) return "robinhood";
  return "other";
}

export function findUrl(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s<>"']+/)?.[0];
}

/** Follow short-link redirects (maps.app.goo.gl, s.shopee.co.th) without loading the final page. */
async function expand(url: string): Promise<string> {
  let cur = url;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(cur, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0" } });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) cur = new URL(loc, cur).toString();
    else break;
  }
  return cur;
}

/** Pull a place name and coordinates out of a Google Maps URL. */
export function parseMapsUrl(url: string): { name?: string; lat?: number; lng?: number } {
  const u = decodeURIComponent(url);
  const name = u.match(/\/maps\/place\/([^/@]+)/)?.[1]?.replace(/\+/g, " ");
  const pin = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const at = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const q = u.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  const coords = pin ?? q ?? at;
  return { name, lat: coords ? Number(coords[1]) : undefined, lng: coords ? Number(coords[2]) : undefined };
}

/** Best-effort shop name for a delivery link: its page title, minus the app's branding. */
async function deliveryName(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0" } });
    const html = (await res.text()).slice(0, 200_000);
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]
      ?? html.match(/<title>([^<]+)<\/title>/i)?.[1];
    return og?.replace(/\s*[|\-–]\s*(GrabFood|Grab|LINE MAN|Wongnai|ShopeeFood|Shopee).*$/i, "").trim() || undefined;
  } catch {
    return undefined;
  }
}

export interface LinkResult { kind: LinkKind; shopId?: string; shopName?: string; needsName?: boolean }

/** Turn a pasted link into a shop row. Delivery shops without a pin are stored without geometry. */
export async function shopFromLink(url: string, hint?: { name?: string; lat?: number; lng?: number }): Promise<LinkResult> {
  const kind = classifyLink(url);
  if (kind === "google_maps") {
    const full = await expand(url).catch(() => url);
    const parsed = parseMapsUrl(full);
    let name = parsed.name ?? hint?.name;
    let lat = parsed.lat, lng = parsed.lng, placeId: string | undefined, types: string[] | undefined;
    if (placesEnabled() && name) {
      const p = await findPlace(name, lat ?? hint?.lat, lng ?? hint?.lng).catch(() => undefined);
      if (p?.displayName && p.location) {
        name = p.displayName.text; lat = p.location.latitude; lng = p.location.longitude; placeId = p.id; types = p.types;
      }
    }
    if (!name) return { kind, needsName: true };
    const r = await upsertShop({ name, lat, lng, googlePlaceId: placeId, types, mapsUrl: url, source: "link" });
    return { kind, shopId: r.id, shopName: name };
  }
  if (kind === "grab" || kind === "lineman" || kind === "shopeefood" || kind === "robinhood") {
    const known = await one<{ id: string; name: string }>("SELECT id, name FROM shop WHERE delivery_links->>$1 = $2", [kind, url]);
    if (known) return { kind, shopId: known.id, shopName: known.name };
    const name = hint?.name ?? (await deliveryName(url));
    if (!name) return { kind, needsName: true };
    const r = await upsertShop({ name, deliveryLinks: { [kind]: url }, kind: "restaurant", source: "link" });
    return { kind, shopId: r.id, shopName: name };
  }
  return { kind };
}
