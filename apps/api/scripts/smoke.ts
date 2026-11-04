// End-to-end smoke test against a running API (npm run start). Sends Thai as UTF-8 JSON.
// Usage: tsx scripts/smoke.ts [lat] [lng]
const base = process.env.API_URL ?? "http://127.0.0.1:8787/api";
const lat = Number(process.argv[2] ?? 13.7373), lng = Number(process.argv[3] ?? 100.5603);

async function call(path: string, body?: unknown) {
  const res = await fetch(base + path, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body),
  });
  const j = (await res.json()) as any;
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(j)}`);
  return j;
}
const show = (label: string, j: any) => {
  console.log(`\n== ${label} ==\nreply: ${j.reply}`);
  for (const o of j.options ?? []) console.log(`  ${o.slot.padEnd(8)} ${o.kind.padEnd(8)} ${o.dish.th}${o.shop ? ` @ ${o.shop.name} (${o.shop.distanceM ?? "?"} m)` : ""} | ${o.reason}`);
};

const first = await call("/suggest", { lat, lng });
show("zero-input suggest", first);
console.log("  context:", JSON.stringify(first.context));

const crit = await call("/chat", { message: "มันไป", lat, lng, lastSuggestionId: first.suggestionId });
show(`chat "มันไป" after ${first.options[0].dish.th}`, crit);

show("chat \"อยากกินเผ็ดๆ ไม่เกิน 100\"", await call("/chat", { message: "อยากกินเผ็ดๆ ไม่เกิน 100", lat, lng }));
show("chat \"ฝนตก อยากกินอะไรน้ำๆ\"", await call("/chat", { message: "อยากกินอะไรน้ำๆ ร้อนๆ", lat, lng }));

const log = await call("/chat", { message: "เมื่อกี้กินข้าวมันไก่ไป", lat, lng });
console.log(`\n== chat log ==\n${JSON.stringify(log)}`);
const done = await call("/log", { dishText: "ข้าวมันไก่", dishId: log.dishId, origin: "homemade", via: "chat", lat, lng });
console.log(`== log as homemade ==\n${JSON.stringify(done)}`);

const after = await call("/suggest", { lat, lng });
show("suggest right after logging ข้าวมันไก่ (satiation)", after);
const acc = await call("/feedback", { suggestionId: after.suggestionId, dishId: after.options[0].dish.id, action: "accept" });
console.log(`\n== accept headline ==\n${acc.reply}`);
console.log("\nstatus:", JSON.stringify((await call("/status")).counts));
