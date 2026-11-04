// Persona voices for templated replies. The persona changes wording only, never the picks.
import type { Option } from "../rank/select.ts";

export type PersonaId = "phuean" | "suphap";

const P = {
  phuean: {
    intro: ["เอาอันนี้เลยแก", "จัดไปเลย", "วันนี้ต้องอันนี้", "ฟันธง"],
    end: "",
    rain: "ฝนตกงี้ ของน้ำร้อนๆ เข้าท่าสุด",
    heat: "ร้อนจัด เอาอะไรสดชื่นๆ",
    mood: "จัดให้ตามที่บ่นไว้เมื่อกี้",
    favourite: "ของโปรดแกเลย",
    new: "ลองอะไรใหม่ๆ บ้าง",
    asked: "ตามที่ขอเป๊ะ",
    light: "เบาๆ หน่อยวันนี้",
    near: "ใกล้มาก เดินไปได้",
    delivery: "สั่งได้เลยไม่ต้องออกไปไหน",
    fallback: "แผนสำรองยามดึก",
    breakfast: "มื้อเช้าต้องอันนี้",
    late: "ดึกแล้ว เอาง่ายๆ",
    reroll: "โอเค งั้นเอาใหม่",
    logged: (d: string) => `จดแล้วว่ากิน ${d} 📝`,
    askOrigin: (d: string) => `${d} ได้มาจากไหนอ่ะ?`,
    askLink: { place: "ขอลิงก์ Google Maps ร้านหน่อย (หรือพิมพ์ชื่อร้านก็ได้)", delivery: "ขอลิงก์ร้านจากแอปหน่อย (Grab / LINE MAN / ShopeeFood)" },
    unknownDish: (t: string) => `จดว่า "${t}" ไว้ก่อนนะ ยังไม่รู้จักเมนูนี้`,
    persona: "โอเค กลับมาคุยแบบเพื่อนละ",
    help: "พิมพ์ \"กินอะไรดี\" หรือบอกว่าอยากกินแบบไหน เช่น \"เผ็ดๆ ไม่เกินร้อย\" ถ้ากินอะไรไปแล้วก็บอกได้ เช่น \"เมื่อกี้กินส้มตำไป\"",
    chat: "ไม่ค่อยเข้าใจอ่ะ ลองพิมพ์ \"กินอะไรดี\" ดู",
    none: "หาไม่เจอเลยอ่ะ ลองบอกว่าอยากกินแนวไหน",
  },
  suphap: {
    intro: ["แนะนำเมนูนี้ครับ", "ขอเสนอเมนูนี้ครับ", "ลองเมนูนี้ไหมครับ"],
    end: "ครับ",
    rain: "ฝนตกอยู่ อาหารร้อนมีน้ำน่าจะเหมาะ",
    heat: "อากาศร้อน เลือกเมนูที่สดชื่น",
    mood: "ปรับตามที่บอกไว้ก่อนหน้า",
    favourite: "เป็นเมนูที่ชอบ",
    new: "เป็นเมนูใหม่ที่ยังไม่เคยลอง",
    asked: "ตรงกับที่ขอ",
    light: "เป็นมื้อเบาๆ",
    near: "ร้านอยู่ใกล้",
    delivery: "สั่งเดลิเวอรี่ได้",
    fallback: "เป็นตัวเลือกสำรอง",
    breakfast: "เหมาะสำหรับมื้อเช้า",
    late: "เป็นเมนูง่ายๆ สำหรับดึก",
    reroll: "รับทราบครับ ลองตัวเลือกนี้แทน",
    logged: (d: string) => `บันทึกแล้วครับว่าทาน ${d}`,
    askOrigin: (d: string) => `${d} ทานจากที่ไหนครับ`,
    askLink: { place: "รบกวนส่งลิงก์ Google Maps ของร้าน หรือพิมพ์ชื่อร้านครับ", delivery: "รบกวนส่งลิงก์ร้านจากแอป (Grab / LINE MAN / ShopeeFood) ครับ" },
    unknownDish: (t: string) => `บันทึก "${t}" ไว้แล้วครับ แต่ยังไม่รู้จักเมนูนี้`,
    persona: "รับทราบครับ จะสนทนาแบบสุภาพครับ",
    help: "พิมพ์ \"กินอะไรดี\" หรือบอกสิ่งที่อยากทาน เช่น \"เผ็ดๆ ไม่เกิน 100 บาท\" และบอกสิ่งที่ทานไปแล้วได้ เช่น \"เมื่อกี้ทานส้มตำ\"",
    chat: "ขออภัยครับ ลองพิมพ์ \"กินอะไรดี\" ได้เลยครับ",
    none: "ยังหาตัวเลือกไม่พบครับ ลองบอกประเภทอาหารที่อยากทานครับ",
  },
} as const;

export const persona = (id: string) => P[id === "suphap" ? "suphap" : "phuean"];

export function reasonLine(o: Option, id: PersonaId): string {
  const p = persona(id);
  const parts = o.reasons
    .map((r) => (p as Record<string, unknown>)[r])
    .filter((x): x is string => typeof x === "string")
    .slice(0, 2);
  return parts.join(" · ");
}

export function suggestionText(head: Option | undefined, id: PersonaId, reroll = false): string {
  const p = persona(id);
  if (!head) return p.none;
  const intro = reroll ? p.reroll : p.intro[Math.floor(Math.random() * p.intro.length)]!;
  const where = head.shop ? ` ร้าน ${head.shop.name}` : "";
  const why = reasonLine(head, id);
  return `${intro}: ${head.dish.th}${where}${why ? ` — ${why}` : ""}`;
}
