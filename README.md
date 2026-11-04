# GinRaiDee (กินอะไรดี)

My purpose for this project is to make a system/chatbot that helps me decide what to eat from the real data and real accessible food and restaurants (including delivery).

## What it does

- Answers "กินอะไรดี?" with one pick plus a few alternatives: a real dish at a real shop nearby, a delivery option, or a 7-Eleven / cook-at-home fallback.
- Works from one tap (time, weather, location, what I ate recently, my diet rules) or from a sentence in Thai or English.
- Learns from what I actually eat and from why I say no ("มันไป", "เพิ่งกิน").

## Run it locally

Needs Node 24+ and Docker.

```bash
npm install
cp .env.example .env        # optional: add GEMINI_API_KEY and GOOGLE_PLACES_API_KEY
npm run setup               # starts Postgres (PostGIS + pgvector) on 127.0.0.1:5433, migrates, seeds 64 dishes
npm run dev                 # API on :8787, web app on http://127.0.0.1:5173
```

Without keys it still works: chat is parsed by Thai/English rules, and shops come from OpenStreetMap (Settings → นำเข้าร้านรอบตัว) or from the Google Maps / delivery links you log.

| Command | What it does |
|---|---|
| `npm test` | Unit tests (parser, dish matching, critiques, Thompson sampling, onboarding) |
| `npm run typecheck` | TypeScript across API and web |
| `npm run smoke -w apps/api` | End-to-end check against a running API |
| `npm run db:reset-me` | Forget my meals and learned taste; keep dishes and shops |

## How it works

- **Interface:** a local web app now (React + Vite + Tailwind); a LINE bot later, on the same core API.
- **API:** TypeScript (Hono), channel-agnostic.
- **Data:** Postgres with PostGIS and pgvector; shops from OpenStreetMap, Google Places and places I add myself.
- **Ranking:** a cascade of hard rules, then linear Thompson sampling over dish attributes × context, then a slate (headline, varied alternative, lighter swap, explore). Gemini only reads messages and rewords replies.

Design and learning notes are in [docs/](docs/README.md); the original spec is [CONCEPT.md](CONCEPT.md).

## Status

Prototype: local web app with onboarding, suggestions, "no because…" rerolls, meal logging with "where from?", and shop import. LINE bot not started.
