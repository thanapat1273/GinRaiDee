import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ChatResponse, type Origin, type OptionView, type Reason, type Status, type SuggestionView } from "./api.ts";
import { Cards } from "./components/Cards.tsx";
import { History, SAMPLE_LOC, Settings, type SavedLoc } from "./components/Drawer.tsx";
import { Onboarding } from "./components/Onboarding.tsx";

type Prompt =
  | { type: "origin"; dishText: string; dishId?: string }
  | { type: "awaitDish" }
  | { type: "awaitLink"; origin: Origin; dishText: string; dishId?: string }
  | { type: "awaitShopName"; origin: Origin; dishText: string; dishId?: string; link?: string };

interface Msg {
  id: number;
  from: "me" | "bot";
  text?: string;
  suggestion?: SuggestionView & { done?: boolean; picked?: string };
  prompt?: Prompt;
}

const LOC_KEY = "ginraidee.loc";
const loadLoc = (): SavedLoc | undefined => { try { return JSON.parse(localStorage.getItem(LOC_KEY) ?? "null") ?? undefined; } catch { return undefined; } };

let nextId = 1;

export function App() {
  const [status, setStatus] = useState<Status>();
  const [loc, setLocState] = useState<SavedLoc | undefined>(loadLoc);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pending, setPending] = useState<Prompt>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"settings" | "history">();
  const [error, setError] = useState<string>();
  const bottom = useRef<HTMLDivElement>(null);
  const lastSuggestion = [...msgs].reverse().find((m) => m.suggestion && !m.suggestion.done)?.suggestion;

  const refresh = useCallback(() => { api.status().then(setStatus).catch((e) => setError(e.message)); }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);
  useEffect(() => {
    if (msgs.length === 0 && status?.user.onboarded) {
      say({ from: "bot", text: status.user.persona === "suphap" ? "สวัสดีครับ กด \"กินอะไรดี?\" ได้เลยครับ" : "หิวยังแก? กด \"กินอะไรดี?\" ได้เลย" });
    }
  }, [status?.user.onboarded]); // eslint-disable-line react-hooks/exhaustive-deps

  const setLoc = (l: SavedLoc) => { setLocState(l); try { localStorage.setItem(LOC_KEY, JSON.stringify(l)); } catch { /* private mode */ } };
  const say = (m: Omit<Msg, "id">) => setMsgs((xs) => [...xs, { ...m, id: nextId++ }]);
  const closeSuggestion = (id: string, picked?: string) =>
    setMsgs((xs) => xs.map((m) => (m.suggestion?.suggestionId === id ? { ...m, suggestion: { ...m.suggestion, done: true, picked } } : m)));

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError(undefined);
    try { return await fn(); } catch (e) { setError((e as Error).message); return undefined; } finally { setBusy(false); }
  }

  function handle(r: ChatResponse) {
    if (r.options?.length && r.suggestionId) {
      say({ from: "bot", text: r.reply, suggestion: { suggestionId: r.suggestionId, reply: r.reply, options: r.options, context: r.context ?? {} } });
      return;
    }
    if (r.needs === "origin" && r.dishText) { say({ from: "bot", text: r.reply, prompt: { type: "origin", dishText: r.dishText, dishId: r.dishId } }); return; }
    if (r.needs === "link" && r.dishText && r.origin) { setPending({ type: "awaitLink", origin: r.origin, dishText: r.dishText, dishId: r.dishId }); }
    if (r.needs === "shopName" && r.dishText && r.origin) { setPending({ type: "awaitShopName", origin: r.origin, dishText: r.dishText, dishId: r.dishId, link: r.link }); }
    say({ from: "bot", text: r.reply });
    if (r.logged) refresh();
  }

  const suggestNow = () => run(async () => handle(await api.suggest(loc)));

  async function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");
    say({ from: "me", text: t });
    const p = pending;
    setPending(undefined);
    if (p?.type === "awaitDish") { say({ from: "bot", text: `${t} ได้มาจากไหน?`, prompt: { type: "origin", dishText: t } }); return; }
    if (p?.type === "awaitLink" || p?.type === "awaitShopName") {
      const link = t.match(/https?:\/\/\S+/)?.[0] ?? (p.type === "awaitShopName" ? p.link : undefined);
      const shopName = link && p.type === "awaitLink" ? undefined : t.replace(/https?:\/\/\S+/, "").trim() || undefined;
      await run(async () => handle(await api.log({ dishText: p.dishText, dishId: p.dishId, origin: p.origin, link, shopName, ...loc })));
      return;
    }
    await run(async () => handle(await api.chat(t, loc, lastSuggestion?.suggestionId)));
  }

  async function chooseOrigin(prompt: Extract<Prompt, { type: "origin" }>, origin: Origin) {
    const label = { place: "ไปกินที่ร้าน", delivery: "สั่งจากแอป", homemade: "ทำเอง / ซื้อทั่วไป", other: "อื่นๆ" }[origin];
    say({ from: "me", text: label });
    setMsgs((xs) => xs.map((m) => (m.prompt === prompt ? { ...m, prompt: undefined } : m)));
    if (origin === "place" || origin === "delivery") {
      setPending({ type: "awaitLink", origin, dishText: prompt.dishText, dishId: prompt.dishId });
      say({ from: "bot", text: origin === "place" ? "ขอลิงก์ Google Maps ร้านหน่อย (หรือพิมพ์ชื่อร้านก็ได้)" : "ขอลิงก์ร้านจากแอปหน่อย (Grab / LINE MAN / ShopeeFood) หรือพิมพ์ชื่อร้าน" });
      return;
    }
    await run(async () => handle(await api.log({ dishText: prompt.dishText, dishId: prompt.dishId, origin, ...loc })));
  }

  const accept = (s: SuggestionView, o: OptionView) => run(async () => {
    const r = await api.feedback({ suggestionId: s.suggestionId, dishId: o.dish.id, shopId: o.shop?.id, action: "accept", ...loc });
    closeSuggestion(s.suggestionId, o.dish.id);
    say({ from: "bot", text: r.reply });
    refresh();
  });
  const reject = (s: SuggestionView, o: OptionView, reason: Reason) => run(async () => {
    say({ from: "me", text: `${o.dish.th}: ไม่เอา` });
    const r = await api.feedback({ suggestionId: s.suggestionId, dishId: o.dish.id, shopId: o.shop?.id, action: "reject", reason, ...loc });
    closeSuggestion(s.suggestionId);
    handle(r);
  });
  const closed = (s: SuggestionView, o: OptionView) => run(async () => {
    if (!o.shop) return;
    await api.reportClosed(o.shop.id);
    closeSuggestion(s.suggestionId);
    say({ from: "bot", text: `จดไว้แล้วว่า ${o.shop.name} ปิด เอาอันใหม่นะ` });
    handle(await api.suggest(loc));
  });

  const noShops = status && status.counts.shops === 0;
  const weather = [...msgs].reverse().find((m) => m.suggestion?.context.weather)?.suggestion?.context.weather;

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      {status && !status.user.onboarded && <Onboarding onDone={() => { refresh(); void suggestNow(); }} />}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-brand-100 bg-brand-50/95 px-4 py-3 backdrop-blur">
        <div className="flex-1">
          <h1 className="text-lg font-bold leading-tight">กินอะไรดี</h1>
          <button type="button" onClick={() => setPanel("settings")} className="text-xs text-stone-600">
            📍 {loc?.label ?? "ยังไม่ตั้งตำแหน่ง"}{weather ? ` · ${Math.round(weather.tempC)}°${weather.raining ? " ฝนตก" : ""}` : ""}
          </button>
        </div>
        <button type="button" onClick={() => setPanel("history")} className="rounded-full p-2 text-lg" aria-label="ประวัติการกิน">🕘</button>
        <button type="button" onClick={() => setPanel("settings")} className="rounded-full p-2 text-lg" aria-label="ตั้งค่า">⚙️</button>
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {!loc && (
          <div className="rounded-xl border border-brand-200 bg-white p-3 text-sm">
            ยังไม่รู้ว่าอยู่ไหน — <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setPanel("settings")}>ตั้งตำแหน่ง</button> หรือ{" "}
            <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setLoc(SAMPLE_LOC)}>ใช้จุดตัวอย่าง (อโศก)</button>
          </div>
        )}
        {loc && noShops && (
          <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm text-stone-700">
            ยังไม่มีข้อมูลร้านแถวนี้ ตอนนี้จะแนะนำเป็นเมนู —{" "}
            <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setPanel("settings")}>นำเข้าร้านรอบตัว</button>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`pop-in flex flex-col ${m.from === "me" ? "items-end" : "items-start"}`}>
            {m.text && (
              <p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 ${m.from === "me" ? "rounded-br-md bg-brand-500 text-white" : "rounded-bl-md bg-white shadow-sm"}`}>{m.text}</p>
            )}
            {m.suggestion && (
              <div className="mt-2 w-full">
                <Cards options={m.suggestion.options} done={!!m.suggestion.done || busy} pickedDish={m.suggestion.picked}
                  onAccept={(o) => accept(m.suggestion!, o)} onReject={(o, r) => reject(m.suggestion!, o, r)} onClosed={(o) => closed(m.suggestion!, o)} />
              </div>
            )}
            {m.prompt?.type === "origin" && (
              <div className="mt-2 flex flex-wrap gap-2">
                {([["place", "🏪 ไปกินที่ร้าน"], ["delivery", "🛵 สั่งจากแอป"], ["homemade", "🏠 ทำเอง / ซื้อทั่วไป"]] as const).map(([o, label]) => (
                  <button key={o} type="button" disabled={busy} onClick={() => chooseOrigin(m.prompt as Extract<Prompt, { type: "origin" }>, o)}
                    className="rounded-full border border-brand-200 bg-white px-3 py-1.5 text-sm active:bg-brand-100">{label}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-sm text-stone-500">กำลังคิด…</p>}
        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">ผิดพลาด: {error}</p>}
        <div ref={bottom} />
      </main>

      <footer className="sticky bottom-0 border-t border-brand-100 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4">
          <button type="button" onClick={suggestNow} disabled={busy} className="shrink-0 rounded-full bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">กินอะไรดี?</button>
          <button type="button" disabled={busy} onClick={() => { setPending({ type: "awaitDish" }); say({ from: "bot", text: "กินอะไรไป? พิมพ์มาได้เลย" }); }}
            className="shrink-0 rounded-full border border-stone-300 px-3 py-1.5 text-sm">📝 บันทึกมื้อ</button>
          <button type="button" disabled={busy} onClick={() => send("อยากกินเบาๆ")} className="shrink-0 rounded-full border border-stone-300 px-3 py-1.5 text-sm">เบาๆ</button>
          <button type="button" disabled={busy} onClick={() => send("สั่งเดลิเวอรี่ดีกว่า")} className="shrink-0 rounded-full border border-stone-300 px-3 py-1.5 text-sm">🛵 สั่ง</button>
          <button type="button" disabled={busy} onClick={() => send("เซเว่นมีอะไรกินบ้าง")} className="shrink-0 rounded-full border border-stone-300 px-3 py-1.5 text-sm">เซเว่น</button>
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
            placeholder={pending?.type === "awaitLink" ? "วางลิงก์ หรือพิมพ์ชื่อร้าน" : pending?.type === "awaitDish" ? "เช่น ข้าวมันไก่" : "พิมพ์ได้เลย เช่น เผ็ดๆ ไม่เกิน 100"}
            className="min-w-0 flex-1 rounded-full border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-brand-500" aria-label="ข้อความ" />
          <button disabled={busy || !input.trim()} className="rounded-full bg-ink px-4 font-semibold text-white disabled:opacity-40">ส่ง</button>
        </form>
      </footer>

      <Settings open={panel === "settings"} onClose={() => setPanel(undefined)} status={status} loc={loc} setLoc={setLoc}
        onPersona={(p) => { void api.setPersona(p).then(refresh); }} refresh={refresh} />
      <History open={panel === "history"} onClose={() => setPanel(undefined)} />
    </div>
  );
}
