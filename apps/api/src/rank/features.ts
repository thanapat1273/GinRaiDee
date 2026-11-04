// φ(dish, context): the feature vector the shared linear model scores.
// Dish attributes are centred on 0.5; interactions carry context ("soupy when raining").
// PRIOR is hand knowledge used as the model's starting belief, not a fixed rule.
import { ATTRS, type Dish } from "../catalog.ts";
import type { Context } from "../context.ts";

export const FEATURES = [
  "bias",
  ...ATTRS.map((a) => `attr:${a}`),
  "base:rice", "base:noodle", "base:other",
  "slot_match",
  "soupy×rain", "hot_dish×rain", "cold_dish×heat", "sour×heat", "heavy×heat",
  "heavy×dinner", "heavy×breakfast", "spicy×breakfast", "noodle×late", "soupy×late",
] as const;
export const DIM = FEATURES.length;

export const PRIOR: Partial<Record<(typeof FEATURES)[number], number>> = {
  slot_match: 0.35,
  "soupy×rain": 0.4,
  "hot_dish×rain": 0.15,
  "cold_dish×heat": 0.3,
  "sour×heat": 0.2,
  "heavy×heat": -0.4,
  "heavy×dinner": 0.1,
  "heavy×breakfast": -0.4,
  "spicy×breakfast": -0.3,
  "noodle×late": 0.1,
  "soupy×late": 0.15,
};

export function priorVector(): number[] {
  return FEATURES.map((f) => PRIOR[f] ?? 0);
}

export function phi(d: Dish, ctx: Pick<Context, "slot" | "weather">): number[] {
  const rain = ctx.weather?.raining ? 1 : 0;
  const heat = ctx.weather && ctx.weather.tempC >= 33 ? 1 : 0;
  const a = d.attrs;
  const v: number[] = [1, ...ATTRS.map((k) => a[k] - 0.5)];
  v.push(d.base === "rice" ? 1 : 0, d.base === "noodle" ? 1 : 0, d.base === "rice" || d.base === "noodle" ? 0 : 1);
  v.push(d.meals.includes(ctx.slot) ? 1 : -1);
  v.push(
    a.soupy * rain,
    (d.temp === "hot" ? 1 : -1) * rain,
    (d.temp === "cold" ? 1 : 0) * heat,
    a.sour * heat,
    (a.heavy - 0.5) * heat,
    (a.heavy - 0.5) * (ctx.slot === "dinner" ? 1 : 0),
    (a.heavy - 0.5) * (ctx.slot === "breakfast" ? 1 : 0),
    (a.spicy - 0.5) * (ctx.slot === "breakfast" ? 1 : 0),
    (d.base === "noodle" ? 1 : 0) * (ctx.slot === "late" ? 1 : 0),
    a.soupy * (ctx.slot === "late" ? 1 : 0),
  );
  return v;
}

/** Context with no weather and a neutral slot, used for onboarding pseudo-observations. */
export const NEUTRAL_CTX = { slot: "lunch" as const, weather: undefined };
