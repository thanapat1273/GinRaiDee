# Docs

Two kinds of document: **learn/** explains how recommendation and food data work in general; **design/** says what this project does and why, with each option graded *use now / later / avoid*. The [decision log](decisions.md) is the one-page summary.

## Reading order

1. [How food apps recommend](learn/01-how-food-apps-recommend.md): Grab, LINE MAN Wongnai, DoorDash, Uber Eats, Swiggy, Delivery Hero, Zomato, and what a one-person app can copy.
2. [Recommender methods for tiny data](learn/02-recommender-methods.md): content vs collaborative, critiquing, bandits, satiation, cold start, LLMs, evaluation.
3. [Design: data gathering](design/01-data-gathering.md): sources, matching, the shop → dish map, freshness, your contributions, licences.
4. [Design: the recommender](design/02-recommender.md): the cascade that answers "กินอะไรดี?".
5. [Design: evaluation](design/03-evaluation.md): what's logged and how to tell if it's improving.
6. [Decision log](decisions.md).

## Where the design lives in code

| Concept | File |
|---|---|
| Dish catalogue, shop-name rules | `data/dishes.json`, `data/shop-keywords.json` |
| Features φ(dish, context) and the prior | `apps/api/src/rank/features.ts` |
| Linear Thompson sampling | `apps/api/src/rank/model.ts` |
| Hard rules, critiques, satiation, favourites | `apps/api/src/rank/score.ts` |
| Availability + slate (headline, alt, lighter, explore) | `apps/api/src/rank/select.ts` |
| Learning from feedback, onboarding design | `apps/api/src/rank/learn.ts` |
| Sources: OSM, Google Places, links | `apps/api/src/sources/` |
| Chat: rules parser, Gemini, persona replies | `apps/api/src/chat/` |

## Glossary

- **Candidate / retrieval:** the cheap first cut of things worth scoring.
- **Critique:** "not this, because…" feedback on a shown item. *Unit* = one attribute.
- **Satiation:** temporarily having had enough of something you still like.
- **Thompson sampling:** pick using one plausible guess drawn from what the model believes; uncertainty turns into exploration automatically.
- **Prior:** what the model believes before seeing your data.
- **Propensity:** the probability an item was shown. Needed to evaluate a new policy on old logs.
- **IPS / SNIPS:** reweighting logged outcomes by propensity to estimate how another policy would have done.
- **MMR (maximal marginal relevance):** pick the next item by score minus similarity to what's already chosen.
- **D-optimal design:** choose questions that shrink the model's uncertainty the most.
- **Train/serve skew:** features computed differently when learning and when serving; avoided by logging φ.
