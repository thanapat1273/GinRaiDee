import { useState } from "react";
import type { OptionView, Reason } from "../api.ts";

const BASE_EMOJI: Record<string, string> = { rice: "🍛", noodle: "🍜", none: "🥗", bread: "🥪", dessert: "🍧" };
const KIND_LABEL: Record<OptionView["kind"], string> = {
  walkin: "ร้านใกล้", delivery: "สั่งได้", seven: "เซเว่น", cook: "ทำเอง", idea: "ไอเดีย",
};
const SLOT_LABEL: Record<OptionView["slot"], string | undefined> = {
  headline: "แนะนำ", alt: undefined, lighter: "เบากว่า", explore: "ลองดู",
};
const APP_LABEL: Record<string, string> = { grab: "Grab", lineman: "LINE MAN", shopeefood: "ShopeeFood", robinhood: "Robinhood" };

export const REASON_CHIPS: { reason: Reason; label: string }[] = [
  { reason: "too_salty", label: "เค็มไป" },
  { reason: "too_fatty", label: "มันไป" },
  { reason: "too_clean", label: "คลีนไป" },
  { reason: "too_spicy", label: "เผ็ดไป" },
  { reason: "too_heavy", label: "หนักไป" },
  { reason: "ate_recently", label: "เพิ่งกิน" },
  { reason: "too_far", label: "ไกลไป" },
  { reason: "too_pricey", label: "แพงไป" },
  { reason: "want_new", label: "อยากลองใหม่" },
];

function distance(m?: number) {
  if (m === undefined) return undefined;
  return m < 1000 ? `${Math.round(m / 10) * 10} ม.` : `${(m / 1000).toFixed(1)} กม.`;
}

function Card({ o, disabled, picked, onAccept, onReject, onClosed }: {
  o: OptionView; disabled: boolean; picked: boolean;
  onAccept: () => void; onReject: (r: Reason) => void; onClosed?: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const head = o.slot === "headline";
  const slot = SLOT_LABEL[o.slot];
  return (
    <article
      className={`pop-in snap-start shrink-0 rounded-2xl border bg-white p-4 shadow-sm ${head ? "w-[82%] border-brand-200" : "w-[70%] border-stone-200"} ${picked ? "ring-2 ring-brand-500" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-xs">
        {slot && <span className={`rounded-full px-2 py-0.5 font-semibold ${head ? "bg-brand-500 text-white" : "bg-stone-100 text-stone-700"}`}>{slot}</span>}
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{KIND_LABEL[o.kind]}</span>
        {o.openNow && <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-700">เปิดอยู่</span>}
      </div>
      <h3 className={`mt-2 font-semibold leading-snug ${head ? "text-xl" : "text-lg"}`}>
        <span aria-hidden className="mr-1">{BASE_EMOJI[o.dish.base] ?? "🍽️"}</span>{o.dish.th}
      </h3>
      <p className="text-xs text-stone-500">{o.dish.en}</p>

      {o.shop && (
        <p className="mt-2 text-sm text-stone-700">
          {o.shop.name}
          {distance(o.shop.distanceM) && <span className="text-stone-500"> · {distance(o.shop.distanceM)}</span>}
          {o.shop.price && <span className="text-stone-500"> · ~{o.shop.price}฿</span>}
        </p>
      )}
      <p className="mt-1 text-xs text-stone-500">~{o.dish.kcal[0]}–{o.dish.kcal[1]} kcal (ประมาณ)</p>
      {o.reason && <p className="mt-2 text-sm text-brand-700">{o.reason}</p>}

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {o.shop?.mapsUrl && <a className="text-brand-700 underline" href={o.shop.mapsUrl} target="_blank" rel="noreferrer">Google Maps</a>}
        {Object.entries(o.shop?.deliveryLinks ?? {}).map(([app, url]) => (
          <a key={app} className="text-brand-700 underline" href={url} target="_blank" rel="noreferrer">สั่งใน {APP_LABEL[app] ?? app}</a>
        ))}
        {o.shop && onClosed && <button type="button" className="text-stone-500 underline" onClick={onClosed}>ร้านปิดแล้ว?</button>}
      </div>

      {picked ? (
        <p className="mt-3 text-sm font-semibold text-brand-700">✓ เลือกแล้ว</p>
      ) : (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={disabled} onClick={onAccept}
            className="flex-1 rounded-xl bg-brand-500 py-2 font-semibold text-white active:bg-brand-600 disabled:opacity-40">ไปเลย</button>
          <button type="button" disabled={disabled} onClick={() => setAsking((v) => !v)} aria-expanded={asking}
            className="rounded-xl border border-stone-300 px-3 py-2 text-stone-700 disabled:opacity-40">ไม่เอา</button>
        </div>
      )}
      {asking && !picked && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="เพราะอะไร">
          {REASON_CHIPS.map((c) => (
            <button key={c.reason} type="button" disabled={disabled} onClick={() => { setAsking(false); onReject(c.reason); }}
              className="rounded-full border border-stone-300 bg-stone-50 px-2.5 py-1 text-sm active:bg-brand-100">{c.label}</button>
          ))}
        </div>
      )}
    </article>
  );
}

export function Cards({ options, done, pickedDish, onAccept, onReject, onClosed }: {
  options: OptionView[]; done: boolean; pickedDish?: string;
  onAccept: (o: OptionView) => void; onReject: (o: OptionView, r: Reason) => void; onClosed: (o: OptionView) => void;
}) {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
      {options.map((o) => (
        <Card key={`${o.slot}-${o.dish.id}-${o.shop?.id ?? o.kind}`} o={o} disabled={done} picked={pickedDish === o.dish.id}
          onAccept={() => onAccept(o)} onReject={(r) => onReject(o, r)} onClosed={o.shop ? () => onClosed(o) : undefined} />
      ))}
    </div>
  );
}
