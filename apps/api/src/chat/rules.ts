// Keyword parser for Thai and English. Works with no API key; Gemini, when configured,
// handles what this misses. Order matters: reject reasons and logs are checked before "suggest".
import type { Intent } from "./intent.ts";

const has = (t: string, words: string[]) => words.some((w) => t.includes(w));

const REASONS: [Intent["reason"], string[]][] = [
  ["too_salty", ["เค็มไป", "เค็มเกิน", "too salty"]],
  ["too_fatty", ["มันไป", "มันเกิน", "เลี่ยน", "too oily", "too fatty", "greasy"]],
  ["too_clean", ["คลีนไป", "สุขภาพไป", "too healthy"]],
  ["too_spicy", ["เผ็ดไป", "เผ็ดเกิน", "too spicy"]],
  ["too_heavy", ["หนักไป", "อิ่มไป", "too heavy"]],
  ["ate_recently", ["เพิ่งกิน", "กินไปแล้ว", "เบื่อ", "ate it", "had it"]],
  ["too_far", ["ไกลไป", "ไกลเกิน", "too far"]],
  ["too_pricey", ["แพงไป", "แพงเกิน", "too expensive", "pricey"]],
  ["want_new", ["อยากลองใหม่", "ของใหม่", "something new", "อะไรใหม่ๆ"]],
];

export function parseRules(message: string): Intent {
  const t = message.toLowerCase().trim();
  const constraints: Intent["constraints"] = {};
  const want: NonNullable<Intent["constraints"]["want"]> = {};

  if (has(t, ["พูดสุภาพ", "สุภาพหน่อย", "be polite", "formal"])) return { intent: "persona", persona: "suphap", constraints };
  if (has(t, ["พูดเล่น", "เป็นกันเอง", "แบบเพื่อน", "casual"])) return { intent: "persona", persona: "phuean", constraints };
  if (has(t, ["ช่วยอะไรได้", "help", "ใช้ยังไง"])) return { intent: "help", constraints };

  for (const [reason, words] of REASONS) {
    if (has(t, words) && !has(t, ["อยากกิน", "หิว"])) return { intent: "reject", reason, constraints };
  }

  // logging: "เมื่อกี้กินส้มตำไป", "กินข้าวมันไก่แล้ว", "ate pad thai"
  const thaiLog = t.match(/(?:เมื่อกี้|เพิ่ง|ตะกี้|วันนี้)?\s*(?:กิน|ทาน|สั่ง)\s*(.+?)\s*(?:ไป(?:แล้ว)?|แล้ว|มา)\s*(?:นะ|อ่ะ|จ้า|ครับ|ค่ะ)?$/);
  const enLog = t.match(/^(?:i\s+)?(?:just\s+)?(?:ate|had)\s+(.+)$/);
  const logText = thaiLog?.[1] ?? enLog?.[1];
  if (logText && !has(t, ["อะไรดี", "ไรดี", "?"])) {
    const origin = has(t, ["ทำเอง", "homemade", "cooked"]) ? "homemade" as const : has(t, ["สั่ง", "grab", "lineman", "ไลน์แมน", "แกร็บ", "delivery"]) ? "delivery" as const : undefined;
    return { intent: "log", log: { dishText: logText, origin }, constraints };
  }

  // constraints for a suggestion
  if (/ไม่(?:เอา)?เผ็ด|not spicy|no spice/.test(t)) want.spicy = -1;
  else if (has(t, ["เผ็ด", "spicy"])) want.spicy = 1;
  if (has(t, ["น้ำๆ", "ซุป", "soup", "ร้อนๆ", "ซด"])) want.soupy = 1;
  if (has(t, ["เบาๆ", "คลีน", "healthy", "light", "ไม่อ้วน"])) { want.clean = 1; want.heavy = -1; }
  if (has(t, ["หนักๆ", "จัดเต็ม", "อิ่มๆ", "heavy", "filling"])) want.heavy = 1;
  if (has(t, ["ไม่มัน", "ไม่เลี่ยน"])) want.fatty = -1;
  if (has(t, ["เปรี้ยว", "sour"])) want.sour = 1;
  if (has(t, ["หวาน", "ของหวาน", "dessert", "sweet"])) want.sweet = 1;
  if (Object.keys(want).length) constraints.want = want;

  if (/ไม่เอาข้าว|no rice/.test(t)) constraints.base = "noodle";
  else if (has(t, ["เส้น", "ก๋วยเตี๋ยว", "noodle"])) constraints.base = "noodle";

  const price = t.match(/(?:ไม่เกิน|under|below|<)\s*(\d{2,4})/) ?? t.match(/(\d{2,4})\s*(?:บาท|฿|baht)/);
  if (price) constraints.maxPrice = Number(price[1]);

  if (has(t, ["เซเว่น", "7-11", "7-eleven", "seven"])) constraints.kind = "seven";
  else if (has(t, ["ทำเอง", "cook"])) constraints.kind = "cook";
  else if (has(t, ["สั่ง", "เดลิเวอรี่", "delivery", "grab", "lineman", "แกร็บ", "ไลน์แมน"])) constraints.kind = "delivery";

  const craving = t.match(/อยากกิน\s*(.+?)(?:\s|$)/)?.[1];
  if (craving && !has(craving, ["อะไร", "ไร"])) constraints.dishText = craving;

  const looksLikeSuggest = has(t, ["กินอะไรดี", "กินไรดี", "หิว", "อยากกิน", "แนะนำ", "what should i eat", "hungry", "recommend", "อะไรดี", "ไรดี"])
    || Object.keys(constraints).length > 0;
  return { intent: looksLikeSuggest ? "suggest" : "chat", constraints };
}
