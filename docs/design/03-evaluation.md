# Design: knowing whether it's good

How we'll tell if the recommender is improving, given only one user's worth of data. Background: [methods §7](../learn/02-recommender-methods.md#7-knowing-whether-its-any-good).

## What we log (already built)

Every answer writes a `suggestion` row:

- **context:** slot, hour, weather, location bucket, chat constraints, session reasons, whether critiques were relaxed, model size;
- **items:** for every card, its rank, slot, dish, shop, kind, score, the feature vector φ, the named score parts, and its **propensity** (the probability it was shown);
- **policy:** the version that produced it (`lints-v1+slate-v1`).

Outcomes land in `feedback` (accept/reject + reason) and `meal_log` (what you actually ate, from where).

Propensities: the headline's is estimated from 200 posterior draws (how often it would win); the explore slot's is exact (1/pool).

## Metrics

| Metric | Target (from the concept) | Notes |
|---|---|---|
| Headline accepted | ≥ 40% | Report with a Wilson interval, never a bare % |
| Any card accepted | — | Slate quality |
| Rerolls per decision | median ≤ 2 | "Click depth" analogue (Swiggy) |
| Time from open to ไปเลย | median < 30 s | Needs client timing |
| Logged meal matches a suggestion | — | Did we predict what you actually ate? |
| Reason-chip mix | — | Rising "เพิ่งกิน" → satiation too weak; rising "ไกลไป" → radius too big |

## Comparing versions

| Option | Good | Bad | Verdict |
|---|---|---|---|
| A/B test two policies on yourself | The real thing | ~400 decisions *per policy* to see a 10-point difference; peeking inflates false positives | **Later**, only for big changes |
| Offline accuracy on your own logs | Easy | Only measures fit to what the old policy chose to show | **Avoid** as a decision tool |
| **SNIPS on the explore slot** | Unbiased with known propensities; no live risk | Needs ~300 randomised events | **Use** once there's data |
| Replay with weight tuning (Delivery Hero style) | Tunes 2–4 weights well | Biased toward the logging policy | **Use** for small weight changes, with care |
| Popularity-only baseline | Shows whether personalisation helps at all | — | **Use**: always compare against it |

## Rules of thumb

- Don't act on per-dish rates with under 10 observations.
- If IPS is dominated by a few huge weights, the estimate is noise. Clip or use SNIPS.
- Friends' data is not your data: evaluate per person.
- A small "win" on a few dozen decisions is not a win.
