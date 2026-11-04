// What a chat message means, as one structured object. Both parsers (rules, Gemini) return this.
import { z } from "zod";

export const ReasonEnum = z.enum([
  "too_salty", "too_fatty", "too_clean", "too_spicy", "too_heavy",
  "ate_recently", "too_far", "too_pricey", "want_new", "other",
]);

export const IntentSchema = z.object({
  intent: z.enum(["suggest", "log", "reject", "persona", "help", "chat"]),
  constraints: z.object({
    want: z.partialRecord(z.enum(["salty", "fatty", "spicy", "sweet", "sour", "clean", "heavy", "soupy"]), z.union([z.literal(1), z.literal(-1)])).optional(),
    base: z.enum(["rice", "noodle", "none", "bread", "dessert"]).optional(),
    maxPrice: z.number().int().positive().optional(),
    dishText: z.string().optional(),
    kind: z.enum(["walkin", "delivery", "seven", "cook"]).optional(),
  }).default({}),
  log: z.object({
    dishText: z.string(),
    origin: z.enum(["place", "delivery", "homemade", "other"]).optional(),
  }).optional(),
  reason: ReasonEnum.optional(),
  persona: z.enum(["phuean", "suphap"]).optional(),
});

export type Intent = z.infer<typeof IntentSchema>;
