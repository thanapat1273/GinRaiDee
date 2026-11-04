import { useEffect, useState } from "react";
import { api, type Loc, type Status } from "../api.ts";

export interface SavedLoc extends Loc { label: string }
export const SAMPLE_LOC: SavedLoc = { lat: 13.7373, lng: 100.5603, label: "อโศก (ตัวอย่าง)" };

/** Accepts "13.73, 100.56" or a Google Maps URL containing @lat,lng or !3d…!4d…. */
export function parseLoc(text: string): Loc | undefined {
  const t = decodeURIComponent(text);
  const m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? t.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : undefined;
}

export function Settings({ open, onClose, status, loc, setLoc, onPersona, refresh }: {
  open: boolean; onClose: () => void; status?: Status; loc?: SavedLoc;
  setLoc: (l: SavedLoc) => void; onPersona: (p: "phuean" | "suphap") => void; refresh: () => void;
}) {
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<string>();
  if (!open) return null;

  const gps = () => {
    setBusy("gps");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, label: "ตำแหน่งปัจจุบัน" }); setBusy(undefined); },
      () => { setResult("เข้าถึงตำแหน่งไม่ได้ ลองใส่พิกัดเองหรือใช้จุดตัวอย่าง"); setBusy(undefined); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };
  const importShops = async (source: "osm" | "places") => {
    if (!loc) return setResult("ตั้งตำแหน่งก่อน");
    setBusy(source); setResult(undefined);
    try {
      const r = await api.importShops({ ...loc, radius: 800, source });
      setResult(`${source === "osm" ? "OpenStreetMap" : "Google Places"}: พบ ${r.found} ร้าน · ใหม่ ${r.created} · รวมกับของเดิม ${r.merged}`);
      refresh();
    } catch (e) { setResult((e as Error).message); } finally { setBusy(undefined); }
  };

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-[88%] max-w-sm overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} aria-label="ตั้งค่า">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">ตั้งค่า</h2>
          <button type="button" onClick={onClose} className="rounded-full px-2 text-2xl leading-none text-stone-500" aria-label="ปิด">×</button>
        </div>

        <section className="mt-5">
          <h3 className="font-semibold">ตำแหน่ง</h3>
          <p className="text-sm text-stone-600">{loc ? `${loc.label} · ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : "ยังไม่ได้ตั้ง"}</p>
          <p className="mt-1 text-xs text-stone-500">เก็บไว้ในเครื่องนี้เท่านั้น</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={gps} disabled={busy === "gps"} className="rounded-lg border px-3 py-1.5 text-sm">ใช้ GPS</button>
            <button type="button" onClick={() => setLoc(SAMPLE_LOC)} className="rounded-lg border px-3 py-1.5 text-sm">จุดตัวอย่าง: อโศก</button>
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const l = parseLoc(manual); if (l) { setLoc({ ...l, label: "ตั้งเอง" }); setManual(""); } else setResult("อ่านพิกัดไม่ออก ใส่แบบ 13.73, 100.56 หรือวางลิงก์ Google Maps"); }}>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="13.73, 100.56 หรือลิงก์ Maps"
              className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm" aria-label="พิกัด" />
            <button className="rounded-lg bg-stone-800 px-3 text-sm text-white">ตั้ง</button>
          </form>
        </section>

        <section className="mt-6">
          <h3 className="font-semibold">ข้อมูลร้านรอบตัว (800 ม.)</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => importShops("osm")} disabled={!!busy} className="rounded-lg border px-3 py-1.5 text-sm">
              {busy === "osm" ? "กำลังนำเข้า…" : "OpenStreetMap (ฟรี)"}</button>
            <button type="button" onClick={() => importShops("places")} disabled={!!busy || !status?.places} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
              title={status?.places ? "" : "ใส่ GOOGLE_PLACES_API_KEY ใน .env ก่อน"}>
              {busy === "places" ? "กำลังนำเข้า…" : "Google Places"}</button>
          </div>
          {result && <p className="mt-2 text-sm text-stone-700">{result}</p>}
        </section>

        <section className="mt-6">
          <h3 className="font-semibold">บุคลิกบอท</h3>
          <div className="mt-2 flex gap-2">
            {(["phuean", "suphap"] as const).map((p) => (
              <button key={p} type="button" onClick={() => onPersona(p)} aria-pressed={status?.user.persona === p}
                className={`rounded-full border px-3 py-1.5 text-sm ${status?.user.persona === p ? "border-brand-500 bg-brand-500 text-white" : ""}`}>
                {p === "phuean" ? "เพื่อนสายกิน" : "สุภาพ"}</button>
            ))}
          </div>
        </section>

        {status && (
          <section className="mt-6 text-sm text-stone-600">
            <h3 className="font-semibold text-ink">สถานะ</h3>
            <p>Gemini: {status.gemini ? "เปิด" : "ปิด (ใช้กฎ)"} · Google Places: {status.places ? "เปิด" : "ปิด"}</p>
            <p>เมนู {status.counts.dishes} · ร้าน {status.counts.shops} · เมนูของร้าน {status.counts.shop_dishes}</p>
            <p>มื้อที่บันทึก {status.counts.meals} · โมเดลเรียนรู้แล้ว {status.counts.learned} ครั้ง</p>
          </section>
        )}
      </aside>
    </div>
  );
}

export function History({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [meals, setMeals] = useState<Awaited<ReturnType<typeof api.history>>["meals"]>([]);
  useEffect(() => { if (open) api.history().then((r) => setMeals(r.meals)).catch(() => {}); }, [open]);
  if (!open) return null;
  const ORIGIN: Record<string, string> = { place: "ร้าน", delivery: "เดลิเวอรี่", homemade: "ทำเอง", other: "อื่นๆ" };
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-[88%] max-w-sm overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} aria-label="ประวัติการกิน">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">กินอะไรไปบ้าง</h2>
          <button type="button" onClick={onClose} className="rounded-full px-2 text-2xl leading-none text-stone-500" aria-label="ปิด">×</button>
        </div>
        {meals.length === 0 && <p className="mt-4 text-sm text-stone-500">ยังไม่มีมื้อที่บันทึก</p>}
        <ul className="mt-3 divide-y">
          {meals.map((m) => (
            <li key={m.id} className="py-2.5">
              <p className="font-medium">{m.name_th ?? m.dish_text}{!m.confirmed && <span className="ml-1 text-xs text-stone-400">(ยังไม่ยืนยัน)</span>}</p>
              <p className="text-xs text-stone-500">
                {new Date(m.eaten_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} · {ORIGIN[m.origin] ?? m.origin}{m.shop_name ? ` · ${m.shop_name}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
