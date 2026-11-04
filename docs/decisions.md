# Decision log

Newest first. Each line links to where the reasoning lives.

| Date | Decision | Instead of | Why | Detail |
|---|---|---|---|---|
| 2026-11-05 | CI on GitHub Actions (checks + end-to-end); no CD until something is deployed | No CI, or CD now | Catches Linux-only and cross-part breakage for free; nothing to deploy yet | [CI/CD](learn/03-ci-cd.md) |
| 2026-11-05 | Local web app first; LINE bot later reuses the same API | Building the LINE bot first | Faster to test with our own UI | [README](../README.md) |
| 2026-11-05 | Postgres + PostGIS + pgvector in Docker | SQLite | Matches the final design | `db/` |
| 2026-11-05 | React + Vite + TypeScript UI, separate Hono API | Next.js | Portfolio value; keeps the API channel-agnostic | `apps/` |
| 2026-11-05 | Linear Thompson sampling with a hand-set prior | Per-dish bandit, LLM ranking, CF | Learns from every meal on tiny data; explores; sane on day one | [recommender D1](design/02-recommender.md#d1-what-produces-the-score) |
| 2026-11-05 | Diet, said-no-today and session critiques are filters, not scores | Soft similarity | Filters can't leak (Delivery Hero vegetarian failure) | [recommender D2](design/02-recommender.md#d2-what-isnt-left-to-the-model) |
| 2026-11-05 | "เพิ่งกิน" = satiation, not dislike | Lowering the dish's score | Favourites come back once boredom fades | [methods §4](learn/02-recommender-methods.md#4-what-food-research-says) |
| 2026-11-05 | Slate = headline + varied + lighter swap + explore | Top-N by score | Diversity; pairing nudges; known propensities | [recommender D4](design/02-recommender.md#d4-what-goes-on-the-cards) |
| 2026-11-05 | Log features and propensities on every suggestion | Logging outcomes only | Without them offline evaluation is impossible | [evaluation](design/03-evaluation.md) |
| 2026-11-05 | Onboarding: 16 dishes by D-optimal design, tap to like/dislike | Popular dishes, or a long form | Most information per tap | [recommender D6](design/02-recommender.md#d6-cold-start) |
| 2026-11-05 | Gemini only parses and rewords; works without a key | LLM in the loop for everything | Cost, consistency, testability | [methods §6](learn/02-recommender-methods.md#6-where-the-llm-belongs) |
| 2026-11-05 | OSM stored as the baseline; Google Places as a cache + live checks | Storing Google data | Google terms allow only place IDs indefinitely | [data §1](design/01-data-gathering.md#1-shop-sources) |
| 2026-11-05 | Shop → dish from name rules + your logs; menu photos later | Scraping menus | No API has menus; scraping breaks terms | [data §3](design/01-data-gathering.md#3-which-dishes-a-shop-sells) |
| 2026-11-05 | Logging asks "where from?" and wants the Maps pin or app link | Free-form logging only | Builds the shop → dish map from real meals | [data §6](design/01-data-gathering.md#6-your-contributions-one-tap-not-forms) |
