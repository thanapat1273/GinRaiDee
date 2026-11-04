// Request context: meal slot (Bangkok time) and current weather.
import type { MealSlot } from "./catalog.ts";

export interface Weather {
  tempC: number;
  raining: boolean;
  code: number;
}

export interface Context {
  now: Date;
  slot: MealSlot;
  hour: number;
  weather?: Weather;
  lat?: number;
  lng?: number;
}

export function bangkokHour(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Bangkok" }).format(d));
}

export function slotFor(hour: number): MealSlot {
  if (hour >= 5 && hour < 10) return "breakfast";
  if (hour >= 10 && hour < 14) return "lunch";
  if (hour >= 14 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "dinner";
  return "late";
}

// Open-Meteo (free for non-commercial use). Cached per ~1 km cell for 15 minutes.
const weatherCache = new Map<string, { at: number; w: Weather }>();
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

export async function getWeather(lat: number, lng: number): Promise<Weather | undefined> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.w;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code&timezone=Asia%2FBangkok`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { current: { temperature_2m: number; precipitation: number; weather_code: number } };
    const w = {
      tempC: j.current.temperature_2m,
      raining: j.current.precipitation > 0.1 || RAIN_CODES.has(j.current.weather_code),
      code: j.current.weather_code,
    };
    weatherCache.set(key, { at: Date.now(), w });
    return w;
  } catch {
    return undefined; // weather is a nice-to-have; never block a suggestion on it
  }
}

export async function buildContext(lat?: number, lng?: number, now = new Date()): Promise<Context> {
  const hour = bangkokHour(now);
  const weather = lat !== undefined && lng !== undefined ? await getWeather(lat, lng) : undefined;
  return { now, hour, slot: slotFor(hour), weather, lat, lng };
}
