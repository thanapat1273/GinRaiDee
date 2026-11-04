// Everything around the learned model: hard rules, critiques, satiation, favourites,
// chat constraints. The model term (θ̃·φ) is added in select.ts. Every term is named so the
// reason line and offline replays can see what drove a pick. Design: docs/design/02-recommender.md
import type { Attr, Dish } from "../catalog.ts";
import type { Context } from "../context.ts";

export type Reason =
  | "too_salty" | "too_fatty" | "too_clean" | "too_spicy" | "too_heavy"
  | "ate_recently" | "too_far" | "too_pricey" | "want_new" | "other";

/** Unit critiques: which attribute a "no, because…" chip pushes down. */
export const REASON_ATTR: Partial<Record<Reason, Attr>> = {
  too_salty: "salty", too_fatty: "fatty", too_clean: "clean", too_spicy: "spicy", too_heavy: "heavy",
};
export const TASTE_REASONS = new Set<Reason>(["too_salty", "too_fatty", "too_clean", "too_spicy", "too_heavy", "other"]);

export interface Constraints {
  want?: Partial<Record<Attr, 1 | -1>>;
  base?: Dish["base"];
  maxPrice?: number;
  dishIds?: string[];
  kind?: "walkin" | "delivery" | "seven" | "cook";
}

export interface Reject { dishId?: string; reason?: Reason; at: Date }

export interface UserState {
  diet: { no?: string[]; jay?: boolean; halal?: boolean; vegetarian?: boolean };
  favourites: Map<string, { alpha: number; beta: number }>; // per-dish memory ("wide" part)
  recentRejects: Reject[];                                   // last 72 h
  recentMeals: { dishId: string; at: Date }[];               // last 7 days
  impressions: Map<string, number>;                           // shown but passed over, last 7 days
}

export const W = {
  favourite: 0.3,     // per-dish memory; keeps a loved dish from being "forgotten"
  satiation: 0.9,     // β in S_d(t)
  constraint: 1.5,    // an explicit ask in chat outweighs an older critique
  impression: 0.06,
  novelty: 0.6,       // only after "อยากลองใหม่"
  oldMood: 0.6,       // critiques from earlier today, as a fading soft penalty
};
const CRITIQUE_DELTA = 0.15;   // a new pick must be this much lower on the criticised attribute
const SESSION_HOURS = 3;       // critiques act as hard filters for this long
const MIN_ELIGIBLE = 3;        // fewer survivors than this → relax to a soft penalty

const hoursAgo = (now: Date, t: Date) => (now.getTime() - t.getTime()) / 3_600_000;

/** Hard rules: a dish that breaks one is never shown. Diet is a filter, never a soft score. */
export function allowed(d: Dish, u: UserState, c: Constraints, now: Date): boolean {
  const no = new Set(u.diet.no ?? []);
  if (d.tags.some((t) => no.has(t))) return false;
  if ((u.diet.jay || u.diet.vegetarian) && !d.tags.includes("vegetarian") && !d.tags.includes("can_be_jay")) return false;
  if (u.diet.halal && (d.tags.includes("pork") || !d.tags.includes("halal_possible"))) return false;
  if (c.base && d.base !== c.base) return false;
  if (c.kind === "seven" && !d.tags.includes("seven")) return false;
  if (c.kind === "cook" && !d.tags.includes("cook")) return false;
  if (u.recentRejects.some((r) => r.dishId === d.id && hoursAgo(now, r.at) < 12)) return false; // said no today
  return true;
}

/**
 * Session critiques as hard filters ("must be less fatty than the rejected dish"), relaxed to a
 * soft penalty if that leaves too few dishes (Felfernig et al.; Reilly et al., dynamic critiquing).
 */
export function applyCritiques(cands: Dish[], u: UserState, dishById: Map<string, Dish>, now: Date) {
  const session = u.recentRejects.filter((r) => r.reason && REASON_ATTR[r.reason] && r.dishId && hoursAgo(now, r.at) < SESSION_HOURS);
  const rules = session.map((r) => ({ attr: REASON_ATTR[r.reason!]!, ref: dishById.get(r.dishId!)!.attrs[REASON_ATTR[r.reason!]!] }));
  if (!rules.length) return { dishes: cands, penalty: () => 0, relaxed: false };
  const ok = (d: Dish) => rules.every((k) => d.attrs[k.attr] <= k.ref - CRITIQUE_DELTA);
  const strict = cands.filter(ok);
  if (strict.length >= MIN_ELIGIBLE) return { dishes: strict, penalty: () => 0, relaxed: false };
  return {
    dishes: cands,
    penalty: (d: Dish) => -1.5 * rules.reduce((s, k) => s + Math.max(0, d.attrs[k.attr] - k.ref + CRITIQUE_DELTA), 0),
    relaxed: true,
  };
}

export interface ScoreParts { [term: string]: number }

/** Non-model terms for one dish. */
export function extraTerms(d: Dish, ctx: Context, u: UserState, c: Constraints): ScoreParts {
  const p: ScoreParts = {};
  const now = ctx.now;

  // favourites: posterior mean of a per-dish Beta, centred on 0 (inherits the parent dish's memory)
  const f = u.favourites.get(d.id) ?? (d.parent ? u.favourites.get(d.parent) : undefined);
  if (f) p.favourite = W.favourite * ((f.alpha / (f.alpha + f.beta)) - 0.5) * 2;

  // satiation S_d(t) = Σ sim(d, meal) · exp(−Δt / τ): 3 days for the same dish, 1 day for its family
  let s = 0;
  for (const m of u.recentMeals) {
    const h = hoursAgo(now, m.at);
    if (m.dishId === d.id) s += Math.exp(-h / 72);
    else if (m.dishId === d.parent || (d.parent !== undefined && m.dishId === d.parent)) s += 0.5 * Math.exp(-h / 24);
  }
  for (const r of u.recentRejects) if (r.reason === "ate_recently" && r.dishId === d.id) s += Math.exp(-hoursAgo(now, r.at) / 72);
  if (s) p.satiation = -W.satiation * s;

  // older critiques from today fade as a soft penalty (half-life 8 h)
  let mood = 0;
  for (const r of u.recentRejects) {
    const attr = r.reason && REASON_ATTR[r.reason];
    const h = hoursAgo(now, r.at);
    if (attr && h >= SESSION_HOURS) mood -= (d.attrs[attr] - 0.3) * Math.pow(0.5, h / 8);
  }
  if (mood) p.mood = W.oldMood * mood;

  // explicit constraints from chat ("อยากกินเผ็ดๆ", "ข้าวซอย")
  if (c.want) p.constraint = W.constraint * Object.entries(c.want).reduce((acc, [a, dir]) => acc + (dir ?? 0) * (d.attrs[a as Attr] - 0.4), 0);
  if (c.dishIds?.length) p.constraint = (p.constraint ?? 0) + (c.dishIds.includes(d.id) || (d.parent && c.dishIds.includes(d.parent)) ? 2 : -0.5);

  // impression fatigue (DoorDash-style): shown again and again without being chosen
  const imp = u.impressions.get(d.id) ?? 0;
  if (imp) p.impression = -W.impression * imp;

  // novelty right after "อยากลองใหม่"
  const wantNew = u.recentRejects.some((r) => r.reason === "want_new" && hoursAgo(now, r.at) < SESSION_HOURS);
  if (wantNew && !f && !u.recentMeals.some((m) => m.dishId === d.id)) p.novelty = W.novelty;

  return p;
}
