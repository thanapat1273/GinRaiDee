// What each kind of feedback teaches. Reward is 1 for ไปเลย or a logged meal, 0 for a
// rejection with a taste reason. Satiation, distance and price reasons teach nothing about taste:
// the scorer reads them straight from recent feedback, so they fade on their own.
import { ATTRS, dishById } from "../catalog.ts";
import { one, query } from "../db.ts";
import { DIM, NEUTRAL_CTX, phi } from "./features.ts";
import { identity } from "./linalg.ts";
import { loadModel, saveModel } from "./model.ts";
import { TASTE_REASONS, type Reason } from "./score.ts";

async function bumpFavourite(userId: string, dishId: string, dAlpha: number, dBeta: number) {
  await query(
    `INSERT INTO taste (user_id, key, alpha, beta) VALUES ($1, $2, 1 + $3, 1 + $4)
     ON CONFLICT (user_id, key) DO UPDATE SET alpha = taste.alpha + $3, beta = taste.beta + $4, updated_at = now()`,
    [userId, `dish:${dishId}`, dAlpha, dBeta]);
}

/** The φ a card was shown with, so learning uses exactly what the scorer saw (no train/serve skew). */
async function shownPhi(suggestionId: string | undefined, dishId: string): Promise<number[] | undefined> {
  if (!suggestionId) return undefined;
  const row = await one<{ phi: number[] }>(
    `SELECT item->'phi' AS phi FROM suggestion, jsonb_array_elements(items) AS item
     WHERE suggestion.id = $1 AND item->>'dish_id' = $2 LIMIT 1`, [suggestionId, dishId]);
  return row?.phi && row.phi.length === DIM ? row.phi : undefined;
}

async function learn(userId: string, phiVec: number[], reward: number, weight = 1) {
  const m = await loadModel(userId);
  m.update(phiVec, reward, weight);
  await saveModel(userId, m);
}

export async function onAccept(userId: string, dishId: string, suggestionId?: string, ctx?: Parameters<typeof phi>[1]) {
  const f = (await shownPhi(suggestionId, dishId)) ?? phi(dishById.get(dishId)!, ctx ?? NEUTRAL_CTX);
  await learn(userId, f, 1);
  await bumpFavourite(userId, dishId, 1, 0);
}

export async function onReject(userId: string, dishId: string | undefined, reason: Reason | undefined, suggestionId?: string) {
  if (!dishId || !dishById.has(dishId)) return;
  if (reason && !TASTE_REASONS.has(reason)) return; // ate_recently, too_far, too_pricey, want_new
  const f = (await shownPhi(suggestionId, dishId)) ?? phi(dishById.get(dishId)!, NEUTRAL_CTX);
  // a chip like "มันไป" is mostly today's mood: learn from it at half weight
  await learn(userId, f, 0, reason && reason !== "other" ? 0.5 : 1);
  if (!reason || reason === "other") await bumpFavourite(userId, dishId, 0, 1);
}

export async function onMeal(userId: string, dishId: string, fromSuggestion: boolean, ctx: Parameters<typeof phi>[1]) {
  if (fromSuggestion) return; // already learned when accepted
  await learn(userId, phi(dishById.get(dishId)!, ctx), 1);
  await bumpFavourite(userId, dishId, 1, 0);
}

/** Onboarding ticks become pseudo-observations, so they shape the prior the same way real data would. */
export async function onOnboarding(userId: string, likes: string[], dislikes: string[]) {
  const m = await loadModel(userId);
  for (const id of likes) { const d = dishById.get(id); if (d) { m.update(phi(d, NEUTRAL_CTX), 1); await bumpFavourite(userId, id, 1, 0); } }
  for (const id of dislikes) { const d = dishById.get(id); if (d) m.update(phi(d, NEUTRAL_CTX), 0); }
  await saveModel(userId, m);
}

/**
 * Onboarding grid: greedy D-optimal design. Each next dish maximises φᵀA⁻¹φ (the same
 * uncertainty LinUCB uses), so 16 ticks teach the model as much as possible.
 */
export function onboardingDishes(n = 16): string[] {
  const pool = [...dishById.values()].filter((d) => !d.tags.includes("seven") && !d.tags.includes("cook") && !d.parent);
  // only the attribute and base features matter for taste; work in that subspace
  const vec = (id: string) => [...ATTRS.map((a) => dishById.get(id)!.attrs[a] - 0.5), ...phi(dishById.get(id)!, NEUTRAL_CTX).slice(1 + ATTRS.length, 4 + ATTRS.length)];
  const k = ATTRS.length + 3;
  let Ainv = identity(k, 1); // (λI)⁻¹ with λ = 1
  const picked: string[] = [];
  while (picked.length < Math.min(n, pool.length)) {
    let best = "", bestV = -1;
    for (const d of pool) {
      if (picked.includes(d.id)) continue;
      const x = vec(d.id);
      const Ax = Ainv.map((row) => row.reduce((s, v, j) => s + v * x[j]!, 0));
      const v = x.reduce((s, xi, i) => s + xi * Ax[i]!, 0);
      if (v > bestV) { bestV = v; best = d.id; }
    }
    picked.push(best);
    // Sherman–Morrison: (A + xxᵀ)⁻¹ = A⁻¹ − (A⁻¹x)(A⁻¹x)ᵀ / (1 + xᵀA⁻¹x)
    const x = vec(best);
    const Ax = Ainv.map((row) => row.reduce((s, v, j) => s + v * x[j]!, 0));
    const denom = 1 + x.reduce((s, xi, i) => s + xi * Ax[i]!, 0);
    Ainv = Ainv.map((row, i) => row.map((v, j) => v - (Ax[i]! * Ax[j]!) / denom));
  }
  return picked;
}
