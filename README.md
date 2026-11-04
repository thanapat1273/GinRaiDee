# GinRaiDee (กินอะไรดี)

My purpose for this project is to make a system/chatbot that helps me decide what to eat from the real data and real accessible food and restaurants (including delivery).

## What it does

- Answers "กินอะไรดี?" with one pick plus a few alternatives: a real dish at a real shop nearby, a delivery option, or a 7-Eleven / cook-at-home fallback.
- Works from one tap (time, weather, location, what I ate recently, my diet rules) or from a sentence in Thai or English.
- Learns from what I actually eat and from why I say no ("มันไป", "เพิ่งกิน").

## How it works (planned)

- **Interface:** a LINE bot, on top of a core API that a native app could use later.
- **Stack:** TypeScript for the LINE bot, API and web pages; Python for data jobs.
- **Data:** Postgres with PostGIS and pgvector; shops from Google Places, OpenStreetMap, delivery-app links and places I add myself.
- **AI:** Gemini for reading messages, writing replies and recognising food photos. Ranking itself is plain rules and weights.

## Status

Concept stage, no code yet. The full spec is in [CONCEPT.md](CONCEPT.md).
