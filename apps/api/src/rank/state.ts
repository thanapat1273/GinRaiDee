// Loads everything the scorer needs about one user in four small queries.
import { one, query } from "../db.ts";
import type { Reason, UserState } from "./score.ts";

export async function loadUserState(userId: string): Promise<UserState> {
  const user = await one<{ diet: UserState["diet"] }>("SELECT diet FROM app_user WHERE id = $1", [userId]);

  const favourites = new Map<string, { alpha: number; beta: number }>();
  for (const r of await query<{ key: string; alpha: number; beta: number }>(
    "SELECT key, alpha, beta FROM taste WHERE user_id = $1 AND key LIKE 'dish:%'", [userId])) {
    favourites.set(r.key.slice(5), { alpha: r.alpha, beta: r.beta });
  }

  const recentRejects = (await query<{ dish_id: string | null; reason: Reason | null; created_at: Date }>(
    `SELECT dish_id, reason, created_at FROM feedback
     WHERE user_id = $1 AND action = 'reject' AND created_at > now() - interval '72 hours'`, [userId]))
    .map((r) => ({ dishId: r.dish_id ?? undefined, reason: r.reason ?? undefined, at: r.created_at }));

  const recentMeals = (await query<{ dish_id: string; eaten_at: Date }>(
    `SELECT dish_id, eaten_at FROM meal_log
     WHERE user_id = $1 AND dish_id IS NOT NULL AND eaten_at > now() - interval '7 days'`, [userId]))
    .map((r) => ({ dishId: r.dish_id, at: r.eaten_at }));

  // shown in the last 7 days minus accepted = how often it was passed over (first showing is free)
  const impressions = new Map<string, number>();
  for (const r of await query<{ dish_id: string; shown: number; accepted: number }>(
    `WITH shown AS (
       SELECT item->>'dish_id' AS dish_id, count(*)::int AS n
       FROM suggestion, jsonb_array_elements(items) AS item
       WHERE user_id = $1 AND created_at > now() - interval '7 days' GROUP BY 1),
     acc AS (
       SELECT dish_id, count(*)::int AS n FROM feedback
       WHERE user_id = $1 AND action = 'accept' AND created_at > now() - interval '7 days' GROUP BY 1)
     SELECT shown.dish_id, shown.n AS shown, coalesce(acc.n, 0) AS accepted
     FROM shown LEFT JOIN acc ON acc.dish_id = shown.dish_id`, [userId])) {
    impressions.set(r.dish_id, Math.max(0, r.shown - 1 - r.accepted * 3));
  }

  return { diet: user?.diet ?? {}, favourites, recentRejects, recentMeals, impressions };
}
