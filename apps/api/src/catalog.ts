// The dish catalogue and shop-name rules, loaded once from /data.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ATTRS = ["salty", "fatty", "spicy", "sweet", "sour", "clean", "heavy", "soupy"] as const;
export type Attr = (typeof ATTRS)[number];
export type MealSlot = "breakfast" | "lunch" | "afternoon" | "dinner" | "late";

export interface Dish {
  id: string;
  th: string;
  en: string;
  parent?: string;
  aliases: string[];
  base: "rice" | "noodle" | "none" | "bread" | "dessert";
  attrs: Record<Attr, number>;
  temp: "hot" | "cold" | "room";
  meals: MealSlot[];
  tags: string[];
  kcal: [number, number];
}

interface NameRule { match: string[]; dishes: string[]; confidence: number }
interface TypeRule { types: string[]; dishes: string[]; confidence: number }

const dataDir = join(import.meta.dirname, "../../../data");

export const dishes: Dish[] = JSON.parse(readFileSync(join(dataDir, "dishes.json"), "utf8")).dishes;
export const dishById = new Map(dishes.map((d) => [d.id, d]));

const keywords: { name_rules: NameRule[]; type_rules: TypeRule[] } = JSON.parse(
  readFileSync(join(dataDir, "shop-keywords.json"), "utf8"),
);

export function attrVector(d: Dish): number[] {
  return ATTRS.map((a) => d.attrs[a]);
}

/** Dishes a shop probably serves, from its name and place types. Highest confidence wins per dish. */
export function guessShopDishes(name: string, types: string[] = []): Map<string, number> {
  const lower = name.toLowerCase();
  const out = new Map<string, number>();
  const add = (id: string, c: number) => out.set(id, Math.max(out.get(id) ?? 0, c));
  for (const rule of keywords.name_rules) {
    if (rule.match.some((m) => lower.includes(m.toLowerCase()))) rule.dishes.forEach((id) => add(id, rule.confidence));
  }
  for (const d of dishes) {
    if ([d.th, ...d.aliases].some((a) => a.length >= 3 && lower.includes(a.toLowerCase()))) add(d.id, 0.8);
  }
  for (const rule of keywords.type_rules) {
    if (rule.types.some((t) => types.includes(t))) rule.dishes.forEach((id) => add(id, rule.confidence));
  }
  return out;
}

/** Best catalogue match for free text such as "ข้าวมันไก่ทอด" or "kaprao". Longest alias wins. */
export function matchDish(text: string): Dish | undefined {
  const lower = text.toLowerCase().replace(/\s+/g, "");
  let best: { d: Dish; len: number } | undefined;
  for (const d of dishes) {
    for (const a of [d.th, ...d.aliases]) {
      const key = a.toLowerCase().replace(/\s+/g, "");
      if (key.length >= 2 && lower.includes(key) && (!best || key.length > best.len)) best = { d, len: key.length };
    }
  }
  return best?.d;
}
