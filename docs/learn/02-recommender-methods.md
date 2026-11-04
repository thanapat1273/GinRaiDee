# Recommender methods that work with tiny data

Learning notes for a recommender with one user and a few hundred decisions, read 2026-11-05. Each section ends with what it means for this bot. Values marked *guess* are starting points to tune, not numbers from the literature.

## 1. The four families

| Family | How it works | Needs | Verdict for us |
|---|---|---|---|
| **Content-based** | Learns which *features* you like (spicy, soupy…) and scores items by them ([Google ML](https://developers.google.com/machine-learning/recommendation/content-based/summary)) | Good item features, your history only | **Use now.** ~25 shared weights learn from every meal |
| **Knowledge / constraint-based** | Rules and requirements ("halal", "under 100฿"); relaxes some when nothing fits ([Felfernig et al.](https://www.ise.bgu.ac.il/faculty/liorr/recsyshb/chConstraint.pdf)) | Hand-built knowledge | **Use now** for diet and session critiques |
| **Collaborative filtering** | "People like you liked…" ([Google ML](https://developers.google.com/machine-learning/recommendation/collaborative/summary)) | Many users with overlapping history | **Avoid.** With 1–5 users the matrix is one row |
| **Hybrid** | Combine them; a *cascade* lets one method refine another's output ([Burke 2002](https://fcd.ugr.es/sites/centros/fcd/public/ficheros/PROYECTO2023/Burke2002_Article_HybridRecommenderSystemsSurvey.pdf)) | — | **Use now:** constraints → content/bandit scoring |

Why content-based works on tiny data: one weight for "soupy when raining" is shared by every soup, so one rainy-day ต้มยำ teaches the model about all soups. A separate score per dish would need each dish to be tried many times.

## 2. Critiquing: turning "no, because…" into a better next pick

A **critique** is feedback on a shown item, used in recommend → review → revise cycles ([Chen & Pu, UMUAI 2012](https://infoscience.epfl.ch/record/176775)).

- **Unit critique:** one feature, one direction ("less salty"). Our chips are unit critiques.
- **Compound critique:** several at once ("lighter *and* cheaper"). Mining frequent compound critiques cut recommendation cycles by up to 40% ([Reilly et al., ECCBR 2004](https://static.aminer.org/pdf/PDF/000/200/043/dynamic_critiquing.pdf)).
- **LLM-era work** treats free-text critiques as steering queries ([REGEN, 2025](https://arxiv.org/abs/2503.11924)); see also the conversational recommender survey ([Jannach et al., 2021](https://arxiv.org/abs/2004.00646)).

**How we model a chip.** A critique works on two timescales:

```
# Now (this session): candidates must beat the rejected dish r on attribute k
eligible(d)  ⇔  a_k(d) ≤ a_k(r) − δ                     δ = 0.15 (guess)
if fewer than 3 dishes survive → soft penalty instead:   −1.5 · max(0, a_k(d) − a_k(r) + δ)
# Long term: a weak learning signal (reward 0 at half weight)
```

Not every chip is a taste critique:

| Chip | What it really means | How we use it |
|---|---|---|
| เค็มไป, มันไป, คลีนไป, เผ็ดไป, หนักไป | Taste critique on one attribute | Session filter + weak long-term update |
| เพิ่งกิน | **Satiation**, not dislike | Raises the "had enough" penalty; taste unchanged |
| ไกลไป | Distance tolerance right now | Halves the radius for 3 hours |
| แพงไป | Price | Price filter; taste unchanged |
| อยากลองใหม่ | Novelty | Boost dishes never eaten |

## 3. Bandits: exploring without wasting meals

The **explore/exploit** problem: keep suggesting what you know works, or try something that might be better?

- **ε-greedy:** best option most of the time, random sometimes. Simple, but it explores blindly ([Russo et al., TS tutorial](https://arxiv.org/abs/1707.02038)).
- **LinUCB:** pick the highest *optimistic* estimate, θᵀx + α·√(xᵀA⁻¹x). Gave a 12.5% click lift on Yahoo news, and its advantage over ε-greedy grew as data shrank. Features shared across items helped most on small data ([Li et al., WWW 2010](https://arxiv.org/abs/1003.0146)).
- **Thompson sampling (TS):** sample plausible weights from the posterior and act greedily on the sample. Very competitive and simple ([Chapelle & Li, NIPS 2011](https://papers.nips.cc/paper/2011/hash/e53a0a2978c28872a4505bdb51db06dc-Abstract.html)).

**Our formulation: linear Thompson sampling with one shared model.**

```
features φ(d, c): dish attributes, base, meal-slot match, and context interactions
                  (soupy×rain, cold×heat, heavy×breakfast, …)
start:    A = λI,  b = λ·μ0          μ0 = hand-set prior (e.g. soupy×rain = +0.4), λ = 3
request:  θ̃ ~ N(A⁻¹b, v²·A⁻¹)         v = 0.35 (guess)
          score(d) = θ̃·φ(d,c) + named terms (satiation, favourites, constraints…)
outcome:  A += w·φφᵀ,  b += w·r·φ     r = 1 accept/ate, 0 taste-reject (w = 0.5 for a chip)
```

Starting from a hand-set prior means the bot behaves sensibly on day one and learns your corrections. In a restaurant study, bandit selection seeded from offline knowledge was the most robust approach ([Christakopoulou et al., KDD 2016](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/06/rfp0063-christakopoulou.pdf)).

## 4. What food research says

- **The survey view:** context (time, place, availability) matters, but nobody agrees how to model it; cold start and sparse feedback are under-studied; evaluation is mostly offline ([Trattner & Elsweiler 2017](https://arxiv.org/abs/1711.02760)).
- **Repeat consumption:** recency is the strongest predictor of eating something again ([Anderson et al., WWW 2014](https://www.cs.toronto.edu/~ashton/slides/repeat-consumption-www2014-slides.pdf)); 15–59% of consumption is repeats ([Benson et al., WWW 2016](https://www.cs.cornell.edu/~arb/papers/sequences-www2016.pdf)); gains come from *not* suggesting what you're bored of and bringing it back once interest recovers ([Kapoor et al., WSDM 2015](https://experts.umn.edu/en/publications/just-in-time-recommendations-modeling-the-dynamics-of-boredom-in-/)).

  So a favourite gets a lasting bonus *and* a temporary satiation penalty:
  ```
  S_d(t) = Σ_meals  sim(d, meal) · exp(−Δt / τ)      τ = 72 h same dish, 24 h same family (guess)
  ```
- **Weather and season:** recipe searches get heavier in winter ([West et al., WWW 2013](https://ar5iv.arxiv.org/html/1304.3742)); weather moves delivery volume ([Yao et al. 2023](https://hit.globalimpact.cn/en/publications/weather-and-time-factors-impact-on-online-food-delivery-sales-a-c/)). Evidence that rain makes people want *soup specifically* wasn't found, so "soup when raining" is a learnable prior, not a hard rule.
- **Health:** people pick the fattier of two recipes and judge fat poorly, but *pairing* a comparable lighter dish nudged choices to it 62% of the time ([Elsweiler et al., SIGIR 2017](https://eprints.whiterose.ac.uk/id/eprint/165585/)). Hence our "lighter swap" slot instead of a health filter.

## 5. Cold start: which dishes to ask about

Which items you ask a new user to rate changes both effort and accuracy ([Rashid et al., IUI 2002](https://experts.umn.edu/en/publications/getting-to-know-you-learning-new-user-preferences-in-recommender-/); [Elahi et al. survey](https://bia.unibz.it/esploro/outputs/journalArticle/A-survey-of-active-learning-in/991006479696201241)). Asking about diverse items beats greedy similar ones, and two questions already improved recommendations 25% ([Christakopoulou et al.](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/06/rfp0063-christakopoulou.pdf)).

**Our rule: greedy D-optimal design.** Each next onboarding dish is the one the model is most uncertain about given the dishes already chosen:

```
A = I;  S = []
repeat 16:  d* = argmax_{d ∉ S} φ_dᵀ A⁻¹ φ_d ;  S.add(d*) ;  A += φ_d* φ_d*ᵀ
```

## 6. Where the LLM belongs

- **As the ranker: avoid.** LLMs ignore the order of your history, favour popular items, and rank differently when the same list is shuffled ([Hou et al., ECIR 2024](https://arxiv.org/abs/2305.08845)). They do worse on non-English-region items and suggest things outside the catalogue ([He et al., CIKM 2023](https://arxiv.org/abs/2308.10053)).
- **As the interface: use.** The LLM is the "brain" for language and the recommender is a tool it calls ([InteRecAgent](https://arxiv.org/abs/2308.16505); [Lin et al. survey](https://arxiv.org/abs/2306.05817)).

So Gemini does three jobs: parse messages into strict JSON (validated), reword replies in the persona, and (offline) draft attributes for new dishes for a human to check.

## 7. Knowing whether it's any good

- **Online metrics:** headline acceptance, any-card acceptance, rerolls per decision, and the reason-chip mix. A rising share of "เพิ่งกิน" means satiation is too weak.
- **Always show uncertainty.** 2/2 is not better than 100/101 ([Evan Miller](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html)). With 200 decisions at ~50% acceptance the 95% interval is about ±7 points; detecting a 10-point difference needs ~400 decisions *per policy*; peeking until significant gave 26% false positives in simulation ([Evan Miller](https://www.evanmiller.org/how-not-to-run-an-ab-test.html)).
- **Offline replay** is only unbiased if the logs come from a randomised policy ([Li et al., WSDM 2011](https://arxiv.org/abs/1003.5956)).
- **Inverse propensity scoring (IPS)** reweights logged outcomes by how likely the new policy is to make each choice compared with the old one ([Eugene Yan](https://eugeneyan.com/writing/counterfactual-evaluation/); [Joachims & Swaminathan](https://www.cs.cornell.edu/~adith/CfactSIGIR2016/)):
  ```
  w_i = π_new(a_i | x_i) / μ_log(a_i | x_i)
  V_SNIPS = Σ w_i r_i / Σ w_i          (self-normalised: lower error on small data)
  ```
  Without the logged probability μ_log you can't do this at all, which is why every suggestion logs its propensity, and why one card slot is a uniform random draw (exact probability 1/pool).
- **Don't trust:** accuracy measured on your own logs, per-dish rates under 10 observations, IPS dominated by a few huge weights, a single replay of an adaptive policy, friends' data pooled as one user.
