// Typed client for the core API (proxied by Vite at /api).

export type Slot = "headline" | "alt" | "lighter" | "explore";
export type Kind = "walkin" | "delivery" | "seven" | "cook" | "idea";
export type Reason =
  | "too_salty" | "too_fatty" | "too_clean" | "too_spicy" | "too_heavy"
  | "ate_recently" | "too_far" | "too_pricey" | "want_new";
export type Origin = "place" | "delivery" | "homemade" | "other";

export interface OptionView {
  slot: Slot;
  kind: Kind;
  reason: string;
  reasons: string[];
  openNow?: boolean;
  dish: { id: string; th: string; en: string; kcal: [number, number]; base: string };
  shop?: { id: string; name: string; distanceM?: number; mapsUrl?: string; deliveryLinks: Record<string, string>; price?: number };
}

export interface SuggestionView {
  suggestionId: string;
  reply: string;
  options: OptionView[];
  context: { slot?: string; weather?: { tempC: number; raining: boolean } | null; critiquesRelaxed?: boolean; modelN?: number };
}

export interface ChatResponse extends Partial<SuggestionView> {
  intent?: string;
  reply: string;
  needs?: "origin" | "link" | "shopName";
  origin?: Origin;
  dishText?: string;
  dishId?: string;
  link?: string;
  logged?: boolean;
}

export interface Status {
  gemini: boolean;
  places: boolean;
  counts: { dishes: number; shops: number; shop_dishes: number; meals: number; learned: number };
  user: { persona: "phuean" | "suphap"; onboarded: boolean; diet: Record<string, unknown> };
}

export interface Loc { lat: number; lng: number }

async function req<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j as T;
}

export const api = {
  status: () => req<Status>("/status"),
  onboardingDishes: () => req<{ dishes: { id: string; th: string; en: string; base: string; kcal: [number, number] }[] }>("/onboarding"),
  onboard: (b: { likes: string[]; dislikes: string[]; diet: { no?: string[]; halal?: boolean; vegetarian?: boolean } }) => req<{ ok: true }>("/onboarding", b),
  suggest: (loc?: Loc) => req<SuggestionView>("/suggest", { ...loc }),
  feedback: (b: { suggestionId: string; dishId: string; shopId?: string; action: "accept" | "reject"; reason?: Reason } & Partial<Loc>) =>
    req<ChatResponse>("/feedback", b),
  chat: (message: string, loc?: Loc, lastSuggestionId?: string) => req<ChatResponse>("/chat", { message, ...loc, lastSuggestionId }),
  log: (b: { dishText: string; dishId?: string; origin: Origin; link?: string; shopName?: string } & Partial<Loc>) =>
    req<ChatResponse>("/log", { ...b, via: "chat" }),
  history: () => req<{ meals: { id: string; dish_text: string; name_th: string | null; origin: string; shop_name: string | null; confirmed: boolean; eaten_at: string }[] }>("/history"),
  setPersona: (persona: "phuean" | "suphap") => req<{ ok: true }>("/me", { persona }, "PUT"),
  importShops: (b: Loc & { radius: number; source: "osm" | "places" }) => req<Record<string, number | boolean | string>>("/shops/import", b),
  reportClosed: (shopId: string) => req<{ ok: true }>(`/shops/${shopId}/closed`, {}),
};
