// First run: tick dishes you like (tap again = don't like), pick diet rules, done.
// No images and one request at the end, so it stays instant.
import { useEffect, useState } from "react";
import { api } from "../api.ts";

const BASE_EMOJI: Record<string, string> = { rice: "🍛", noodle: "🍜", none: "🥗", bread: "🥪", dessert: "🍧" };
type Mark = "like" | "dislike" | undefined;

const DIET: { key: string; label: string; apply: (d: Diet) => Diet }[] = [
  { key: "pork", label: "ไม่กินหมู", apply: (d) => ({ ...d, no: [...(d.no ?? []), "pork"] }) },
  { key: "beef", label: "ไม่กินเนื้อ", apply: (d) => ({ ...d, no: [...(d.no ?? []), "beef"] }) },
  { key: "seafood", label: "ไม่กินอาหารทะเล", apply: (d) => ({ ...d, no: [...(d.no ?? []), "seafood"] }) },
  { key: "peanut", label: "แพ้ถั่ว", apply: (d) => ({ ...d, no: [...(d.no ?? []), "peanut"] }) },
  { key: "halal", label: "ฮาลาล", apply: (d) => ({ ...d, halal: true }) },
  { key: "jay", label: "เจ / มังสวิรัติ", apply: (d) => ({ ...d, vegetarian: true }) },
];
interface Diet { no?: string[]; halal?: boolean; vegetarian?: boolean }

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [dishes, setDishes] = useState<{ id: string; th: string; en: string; base: string }[]>([]);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [diet, setDiet] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.onboardingDishes().then((r) => setDishes(r.dishes)).catch(() => setDishes([])); }, []);

  const likes = Object.entries(marks).filter(([, m]) => m === "like").map(([id]) => id);
  const dislikes = Object.entries(marks).filter(([, m]) => m === "dislike").map(([id]) => id);
  const cycle = (id: string) => setMarks((m) => ({ ...m, [id]: m[id] === undefined ? "like" : m[id] === "like" ? "dislike" : undefined }));
  const toggleDiet = (k: string) => setDiet((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  async function finish(skip = false) {
    setSaving(true);
    const d = DIET.filter((x) => diet.has(x.key)).reduce<Diet>((acc, x) => x.apply(acc), {});
    try {
      await api.onboard(skip ? { likes: [], dislikes: [], diet: d } : { likes, dislikes, diet: d });
      onDone();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-brand-50" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pb-28 pt-6">
        <h1 id="ob-title" className="text-2xl font-bold">ชอบกินอะไรบ้าง?</h1>
        <p className="mt-1 text-sm text-stone-600">แตะ = ชอบ · แตะอีกที = ไม่ชอบ · ไม่ต้องครบทุกอัน</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {dishes.length === 0 && Array.from({ length: 8 }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-white/70" />)}
          {dishes.map((d) => {
            const m = marks[d.id];
            return (
              <button key={d.id} type="button" onClick={() => cycle(d.id)} aria-pressed={m === "like"}
                className={`flex h-16 items-center gap-2 rounded-xl border px-3 text-left transition-colors ${m === "like" ? "border-brand-500 bg-brand-100" : m === "dislike" ? "border-stone-300 bg-stone-200 text-stone-500 line-through" : "border-stone-200 bg-white"}`}>
                <span aria-hidden className="text-xl">{m === "like" ? "❤️" : m === "dislike" ? "🙅" : BASE_EMOJI[d.base] ?? "🍽️"}</span>
                <span className="text-sm font-medium leading-tight">{d.th}</span>
              </button>
            );
          })}
        </div>
        <h2 className="mt-6 font-semibold">ข้อจำกัดเรื่องอาหาร</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {DIET.map((x) => (
            <button key={x.key} type="button" onClick={() => toggleDiet(x.key)} aria-pressed={diet.has(x.key)}
              className={`rounded-full border px-3 py-1.5 text-sm ${diet.has(x.key) ? "border-brand-500 bg-brand-500 text-white" : "border-stone-300 bg-white"}`}>{x.label}</button>
          ))}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => finish(true)} disabled={saving} className="px-2 py-2 text-sm text-stone-500">ข้าม</button>
          <button type="button" onClick={() => finish(false)} disabled={saving}
            className="flex-1 rounded-xl bg-brand-500 py-3 font-semibold text-white disabled:opacity-50">
            {saving ? "กำลังบันทึก…" : likes.length ? `เริ่มเลย (${likes.length} ที่ชอบ)` : "เริ่มเลย"}
          </button>
        </div>
      </div>
    </div>
  );
}
