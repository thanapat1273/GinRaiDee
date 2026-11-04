// Gemini as the language layer only: it turns a message into an Intent and can reword
// a reply in the user's persona. It never ranks dishes. Off when GEMINI_API_KEY is unset.
import { GoogleGenAI } from "@google/genai";
import { IntentSchema, type Intent } from "./intent.ts";

const key = () => process.env.GEMINI_API_KEY ?? "";
const model = () => process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
export const geminiEnabled = () => key().length > 0;

let client: GoogleGenAI | undefined;
const ai = () => (client ??= new GoogleGenAI({ apiKey: key() }));

const ATTR = { type: "integer", enum: [1, -1] };
const JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["suggest", "log", "reject", "persona", "help", "chat"] },
    constraints: {
      type: "object",
      properties: {
        want: { type: "object", properties: { salty: ATTR, fatty: ATTR, spicy: ATTR, sweet: ATTR, sour: ATTR, clean: ATTR, heavy: ATTR, soupy: ATTR } },
        base: { type: "string", enum: ["rice", "noodle", "none", "bread", "dessert"] },
        maxPrice: { type: "integer" },
        dishText: { type: "string" },
        kind: { type: "string", enum: ["walkin", "delivery", "seven", "cook"] },
      },
    },
    log: { type: "object", properties: { dishText: { type: "string" }, origin: { type: "string", enum: ["place", "delivery", "homemade", "other"] } }, required: ["dishText"] },
    reason: { type: "string", enum: ["too_salty", "too_fatty", "too_clean", "too_spicy", "too_heavy", "ate_recently", "too_far", "too_pricey", "want_new", "other"] },
    persona: { type: "string", enum: ["phuean", "suphap"] },
  },
  required: ["intent"],
};

const SYSTEM = `You read one chat message from a Thai user of a food-decision bot and return JSON only.
intent: suggest (wants a food idea, incl. "กินอะไรดี", "หิว", cravings), log (tells what they ate), reject (says no to the last idea, give reason),
persona (asks the bot to talk politely = suphap, or casually = phuean), help, chat (anything else).
constraints.want: +1 = wants more of an attribute now, -1 = less (e.g. "เบาๆ" => clean:1, heavy:-1; "ไม่เผ็ด" => spicy:-1).
constraints.dishText: a specific dish they crave, in Thai as written. maxPrice in baht. kind: walkin, delivery, seven (7-Eleven), cook.
log.dishText: what they ate, as written; log.origin if stated (place = a shop they went to, delivery = ordered in an app, homemade).
reason codes: เค็มไป too_salty, มันไป/เลี่ยน too_fatty, คลีนไป too_clean, เผ็ดไป too_spicy, หนักไป too_heavy, เพิ่งกิน ate_recently, ไกลไป too_far, แพงไป too_pricey, อยากลองใหม่ want_new.`;

export async function parseGemini(message: string): Promise<Intent | undefined> {
  if (!geminiEnabled()) return undefined;
  try {
    const res = await ai().models.generateContent({
      model: model(),
      contents: message,
      config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseJsonSchema: JSON_SCHEMA, temperature: 0 },
    });
    const parsed = IntentSchema.safeParse(JSON.parse(res.text ?? "{}"));
    return parsed.success ? parsed.data : undefined; // schema features like minLength aren't enforced server-side
  } catch (err) {
    console.warn("gemini parse failed:", (err as Error).message);
    return undefined;
  }
}

/** Reword a templated reply in the persona's voice, keeping every fact. Falls back to the template. */
export async function rewordGemini(text: string, persona: string): Promise<string> {
  if (!geminiEnabled()) return text;
  const voice = persona === "suphap"
    ? "polite Thai assistant: ครับ, no slang, no teasing, short"
    : "casual Thai food-obsessed friend (เพื่อนสายกิน): slang, light teasing, decisive, short, at most one emoji";
  try {
    const res = await ai().models.generateContent({
      model: model(),
      contents: `Rewrite in the voice of a ${voice}. Keep every dish name, shop name, number and fact exactly; add nothing. One or two sentences.\n\n${text}`,
      config: { temperature: 0.7, maxOutputTokens: 120 },
    });
    return res.text?.trim() || text;
  } catch {
    return text;
  }
}
