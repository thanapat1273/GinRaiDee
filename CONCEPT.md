# กินอะไรดี — App Concept

Status: concept v1, 2026-11-05. A personal project: a system that helps me decide what to eat.
Working name: undecided (candidates: กินยัง / KinYang, หิวยัง, อิ่มดี).

## 1. What it is

A LINE bot with the personality of a food-obsessed friend (เพื่อนสายกิน). It answers **กินอะไรดี** with one confident pick: a real dish at a real nearby shop, a delivery option, or a 7-Eleven / cook-at-home fallback. It learns from what I ate and from why I said no.

**Core ideas**
- When I can't decide, I still know at once what I *don't* want and why ("มันไป", "เค็มไป", "เพิ่งกิน"). Those rejection reasons steer the next pick.
- The key data is a dish-by-dish map: which stall near me sells ข้าวมันไก่ for 50฿ and is open now. Street stalls are barely on Google, so this map (`shop_dish`) is built up over time.

## 2. v1 scope

| | v1 | Later |
|---|---|---|
| Users | Me (and maybe a few friends) | Native app |
| Area | In depth around home and work (street stalls included) + Bangkok-wide data from Google Places / OSM | Other cities, regional dishes |
| Moment | Solo กินอะไรดี | Group decisions in LINE groups, "craving → where", travel discovery |
| Outputs | Dish idea, real shop nearby, delivery link (Grab / LINE MAN / ShopeeFood), 7-Eleven / cook-at-home | Booking links |
| Signals | Time + weather, recent meals, diet & health; price only when I say it | Budget / payday cycle, who I'm eating with |
| Platform | LINE bot + pages inside LINE (LIFF / MINI App) | Native app on the same API |

## 3. Core experience

### Two ways in
- **Zero-input:** a menu button ("กินอะไรดี?") → a pick from time, weather, location, recent meals and diet rules. With no history: defaults for the time and weather. With history: a mix of usual picks and new dishes similar to them.
- **Chat (TH/EN, slang):** "หิวแล้ว อยากกินเผ็ดๆ ไม่เกินร้อย แถวอโศก" → `{spicy: high, max_price: 100, near: "Asok"}`.

### Answer format
- 1 headline pick + 2 or more alternatives (as many as found, cap 4) in a swipeable card carousel (a Flex carousel in LINE).
- Card: dish, shop, distance, typical price, open now, calorie range, one-line reason in the persona's voice, and a delivery link when the shop is on a delivery app.
- The alternatives differ from each other: a familiar favourite / a new dish similar to favourites / a lighter option.
- Nothing suitable open → dish idea, 7-Eleven combo, or a simple dish to cook.

### Rejection loop ("ไม่เอา เพราะ...")
Quick reasons on every card: เค็มไป · มันไป · คลีนไป · เผ็ดไป · หนักไป · เพิ่งกิน · ไกลไป · แพงไป · อยากลองใหม่ + free text.
Each reason shifts the dish attribute weights for the rest of the day (strong effect), then fades over a few days. Repeated reasons become lasting preferences.

### Logging what was eaten
1. Tap "ไปเลย" → provisional log.
2. Check-in ("กินอะไรไป? อร่อยไหม?") → confirm / correct with quick buttons.
3. Food photo → Gemini vision names the dish (and the shop, if location is shared).
4. Free chat any time: "เมื่อกี้กินส้มตำไป".

Check-ins are attached to the bot's **reply** the next time I write, where possible. Replies are free; messages the bot sends first use the free plan's 300-a-month quota.

### Wishlist from links
Send the bot a TikTok / Facebook / delivery-app link (or a screenshot) → Gemini pulls out the shop and dish → saved to "อยากลอง" → suggested more often when I'm nearby. TikTok and Facebook embeds no longer return captions, so screenshots and delivery-app links are the reliable inputs.

### Onboarding: tick 10 dishes
A LIFF page with a grid of classic Thai dishes to tick or swipe, plus one row of diet chips (halal, เจ, allergies).
Performance targets:
- Usable in < 1 s on 4G; static page on a CDN.
- Photos compressed (~30 KB WebP); first 12 loaded with the page, the rest in the background.
- No login screen (LIFF already identifies the user).
- Every tap responds instantly; one save at the end with automatic retry.
- Done in < 30 s; "ข้าม" always visible; first pick arrives in chat as soon as the page closes.

## 4. Persona system

The persona changes **how the bot talks, never what it recommends**.
- Built-in: `เพื่อนสายกิน` (default) and `สุภาพ`.
- Mirrors my style on every message (formality, slang, emoji, length, particles).
- When the style drifts far enough → saved as a named snapshot. Switch any time ("พูดสุภาพหน่อย" or the persona list). Saved personas are never deleted.
- Persona = style settings + 3–5 example lines (not a free-form prompt).

```ts
type Persona = {
  id: string; name: string; builtIn: boolean;
  formality: number;      // 0..1
  slang: number;          // 0..1
  teasing: number;        // 0..1
  emoji: number;          // 0..1
  pronouns: { self: string; user: string };   // เรา/แก, ผม/คุณ
  particles: string[];    // ["อ่ะ","ป่ะ","จ้า"] | ["ครับ"] | ["ค่ะ"]
  replyLength: "short" | "medium";
  examples: string[];     // 3–5 lines
};
```

## 5. How a pick is made

Simple rules and weights rank the dishes. The LLM only (a) turns chat into constraints, (b) writes the reply in the persona, (c) does vision and extraction. That keeps it cheap, fast and easy to debug.

```
 Read context ──► Apply hard rules ──► Score dishes ──► Find open shops
 (time, weather,   (halal, เจ,          (taste + context   (walk-in or delivery;
  place, profile,   allergies are        fit, today's mood,  else 7-Eleven / cook)
  recent meals)     never broken)        repeats)                  │
      ▲                                       ▲                    ▼
      │                                       │ reason given:  Answer card
 Taste profile ◄── Log the meal ◄──── I react ◄─────────── (1 pick + 2–4 more,
 (lasting likes/    (tap, check-in,    ไปเลย → log          in the persona's voice)
  dislikes)          photo, chat)      ไม่เอา → rescore
```

### Data model (first pass)

| Entity | Key fields |
|---|---|
| `dish` | standard name, aliases (กะเพรา/กระเพรา/kaprao), parent/variant (ก๋วยเตี๋ยว × noodle × broth), attribute scores 0..1 (salty, fatty, spicy, sweet, sour, clean, heavy, soupy, hot/cold), base (rice/noodle/none), region, usual meal times, diet tags (pork, beef, seafood, peanut, halal_possible, jay), kcal + macro ranges, embedding |
| `shop` | google_place_id (nullable), own id, geom (PostGIS), hours, price level, delivery links per app, sources |
| `shop_dish` | shop_id, dish_id, price, confidence, source, last_seen |
| `user` | line_user_id, display name, home/work pins |
| `user_profile` | hard diet rules, taste vector, saved personas |
| `event` | shown / accepted / rejected(reason) / ate(source: tap, check-in, photo, chat) / rating / mood |

### Scoring (v1, hand-set weights)
```
score(dish) = taste_affinity
            + context_fit(time, weather)
            + session_mood_shift(today's rejection reasons, decaying)
            − repeat_penalty(last 72 h)
            + wishlist_boost(near a saved place)
```
- Headline = highest expected acceptance; alternatives chosen for variety (MMR).
- Exploration: ~1 in 3 picks is a nearby dish in embedding space not eaten recently. Tune by acceptance rate.
- Switch to a learned model (e.g. a contextual bandit) once there are a few thousand logged decisions.

### Cold start
- No data: defaults by time slot and weather (breakfast: โจ๊ก, ข้าวต้ม, ปาท่องโก๋ + น้ำเต้าหู้; rainy evening: ต้มยำ, หมูกระทะ).
- After onboarding: embeddings turn the 10 ticks into a starting taste vector.

## 6. Shop and dish data

| Source | Gives | Storage rule | When |
|---|---|---|---|
| Google Places (New) | Shop exists, location, hours, rating | place_id can be stored indefinitely; lat/lng ≤ 30 days (2024 terms — recheck); names, hours and ratings need a fresh lookup | v1 baseline |
| OpenStreetMap | Restaurants and cafés with coordinates | Free to store with attribution (ODbL) | v1 baseline |
| Me, in chat | Street stalls, dishes, prices + location pin | My own data | v1 |
| Shared links / screenshots | Shop + dish from TikTok, Facebook or delivery-app shares | Store the facts + link, not the post | v1 |
| Delivery-app share links | Which shops deliver, and a link to open them (Grab, LINE MAN, ShopeeFood, Robinhood) | Store the link | v1 |
| Gemini + Search grounding | Fill gaps ("does this shop sell ข้าวซอย?") | Store the extracted fact + source | v1, inside free quota |

Wongnai is out: its terms (amended 2024-09-05) ban collecting its store data without permission.

**Pipeline (Python jobs)**
1. One import module per source; each can be switched off independently.
2. Match the same shop across sources: normalised TH/EN name + distance < 50 m + phone.
3. Menu text → standard dish: embeddings propose a match, Gemini confirms.
4. Freshness: `last_seen` + decaying `confidence`; "ร้านปิดแล้ว" lowers it at once.

**Rules for collected data:** facts only (no copied reviews, photos, reviewer names); follow robots.txt and rate limits; nothing behind a login or paywall; no getting around anti-bot protection.

## 7. Calories and nutrition

**v1 (lightweight):** a recipe template per standard dish (ingredients with gram ranges) × Thai FCD (INMU, Mahidol) values → a kcal / macro range on each card ("~X–Y kcal"), adjusted for extras (พิเศษ, ไข่ดาว, หนังไก่, กะทิ). Gemini drafts the templates; I spot-check them. 7-Eleven ready meals use their nutrition label (a photo of it works).

**v2 (photo):**
1. Photo → Gemini vision: dish + visible parts (amount of rice, protein, egg, sauce, oil).
2. Template gram ranges adjusted to what's visible → kcal, protein, carbs, fat as ranges.
3. One-tap corrections ("ข้าวน้อย", "ไม่ใส่ไข่", "พิเศษ") recalculate.
4. Daily total in the evening check-in reply.

Photo estimates are rough (mixed dishes are hard), so always show ranges. Thai FCD is free for non-commercial use with credit.

## 8. Architecture and stack

```
 LINE bot layer (TS) ──┐                 ┌──► Gemini (parse, voice, vision, extraction)
 Pages in LINE (TS)  ──┼──► Core API (TS) ◄┤
 Native app (later) ┄┄─┘   suggest, feedback,└─── Weather (Open-Meteo or TMD)
                           log, profile,
                           persona, ranking
                                 │
                                 ▼
                           Postgres ◄──── Data jobs (Python) ◄── Sources
                           PostGIS + pgvector   imports, matching,     Places, OSM,
                                                dish mapping, nutrition  my links
```

- **LINE bot layer (TypeScript):** Messaging API webhook, Flex carousels, quick replies, loading animation, rich menu. A thin layer over the core API.
- **Pages in LINE:** built as a LINE MINI App, LIFF SDK ≥ 2.31.1 (2.20.0–2.31.0 are blocked around 2026-11-24). Static on a CDN.
- **Core API (TypeScript, e.g. Hono on Node):** doesn't depend on LINE: `POST /suggest`, `POST /feedback`, `POST /log`, `GET/PUT /profile`, `GET/PUT /persona`.
- **Data jobs (Python):** scheduled imports, entity matching, dish mapping, nutrition tables, embeddings.
- **DB:** Postgres + PostGIS + pgvector.
- **LLM:** Gemini Flash-Lite for parsing and replies; a vision-capable Flash model for photos; `gemini-embedding-2` for dish vectors. Use the paid tier so my data isn't used for training.

## 9. Running cost (target ≤ 1,000฿ / month)

Prices assume ~33฿/USD. Research date 2026-11-04 — **recheck before building**.

| Item | Plan | Est. ฿/month |
|---|---|---|
| LINE Official Account | Free plan: unlimited replies, 300 bot-initiated messages/month | 0 |
| Gemini Flash-Lite | A few thousand turns × (~2,000 in + 300 out tokens) | 50–250 |
| Gemini embeddings | Dish table | ≈ 0 |
| Google Places (New) | IDs-only search free & unlimited; Details Essentials 10k free; Pro 5k free; Enterprise 1k free | 0 within caps |
| Grounding (Search) | 5,000 free/month, then $14 per 1,000 | 0 within caps |
| Weather | Open-Meteo (non-commercial) or TMD open data | 0 |
| Hosting | Not priced yet | ≤ ~750 left |

- Stay on the LINE free plan and keep the bot reply-driven.
- Places bills each call at the **highest tier of any field requested** (name = Pro; hours/rating = Enterprise). Fetch hours only for the headline pick.
- Limit Gemini "thinking" tokens (billed as output).
- Models: 3.5 Flash-Lite ($0.30 / $2.50 per 1M) or 3.1 Flash-Lite ($0.25 / $1.50). Avoid 2.5 Flash (shuts down 2026-12-01).

## 10. Privacy

- Diet rules (halal, เจ, allergies) are sensitive personal data under Thailand's PDPA. If friends use the bot, ask for explicit consent and make those fields optional.
- Keep identity (LINE ID, name, exact home/work pins, photos) in its own schema, separate from meal logs.
- "ลบข้อมูลฉัน" deletes everything; "ข้อมูลฉัน" exports it.

## 11. กินตาม — eat what friends eat (later)

Friends share a meal in one tap; I can eat or order the same thing.

**Connecting friends** — no platform hands over friend lists (Instagram/TikTok APIs return only your own posts; LINE Login has no friend list; Facebook returns only friends already using the app). So connections are made inside LINE:
- Friend invite via `liff.shareTargetPicker` → they tap → both sides connected.
- Bot in a LINE group → members tap "เข้าร่วม" to join the group's circle.

**Sharing:** one tap after logging a meal, or share a delivery-app link into the bot. Friends see it instantly. Shares near someone's home pin are never shown.

**What I can do with a friend's meal**
- **กินตาม:** same shop + dish, distance, open now, directions.
- **Order the same:** open it in Grab / LINE MAN / ShopeeFood / Robinhood.
- **Save to อยากลอง** — fed to the core engine.
- **React and ask:** อร่อยไหม? / น่ากิน.
- Friends' meals are also a ranking signal and a reason line ("เพื่อนกินร้านนี้เมื่อวาน").

## 12. Roadmap and metrics

| Phase | Scope | Check before moving on |
|---|---|---|
| 0. Core loop | Dish catalogue, zero-input + chat, rejection chips, my own shops pinned, "ไปเลย" logging, delivery links | I use it daily for 2 weeks |
| 1. Learn and delight | 10-dish onboarding, check-ins, photo log, personas, link wishlist, Bangkok-wide data | ≥ 40% of headline picks accepted |
| 2. Nutrition and friends | Photo macros (v2), กินตาม with friends, group mode in LINE groups, swipe card deck | — |

| Metric | Target |
|---|---|
| Open → "ไปเลย" | median < 30 s |
| Headline pick accepted | ≥ 40% |
| Rerolls per decision | median ≤ 2 |
| Meals logged per week | ≥ 7 |
| Picks that turn out wrong or closed | < 5% |
| Onboarding completed | median < 30 s |

## 13. Risks and open questions

- Street-stall coverage depends on me (and friends) adding stalls.
- Onboarding dish photos need a licence (take my own / generate).
- Check-ins vs the 300-a-month limit on bot-initiated LINE messages.
- Photo calories are rough — always show ranges.
- API prices change; recheck Gemini and Places before building.

Open:
- [ ] Name
- [ ] Exact home + work areas and search radius
- [ ] Group mode design (voting in LINE groups, "อะไรก็ได้" breaker)
- [ ] Hosting choice and cost
- [ ] Source of dish photos
- [ ] Delivery-app share-link formats on Android

## Sources (checked 2026-11-04)

- LINE Messaging API — which messages count: https://developers.line.biz/en/docs/messaging-api/pricing/ · reference: https://developers.line.biz/en/reference/messaging-api/
- LINE MINI App: https://developers.line.biz/en/docs/line-mini-app/discover/introduction/ · news: https://developers.line.biz/en/news/2026/
- Google Maps Platform pricing: https://developers.google.com/maps/billing-and-pricing/pricing · data fields: https://developers.google.com/maps/documentation/places/web-service/data-fields · policies: https://developers.google.com/maps/documentation/places/web-service/policies
- Gemini API pricing: https://aistudio.google.com/docs/pricing · deprecations: https://aistudio.google.com/docs/deprecations
- Thai FCD (INMU): https://inmu.mahidol.ac.th/thaifcd/content/1
- Open-Meteo terms: https://open-meteo.com/en/terms · TMD NWP API: https://data.tmd.go.th/nwpapi/
- Instagram media fields: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media · Facebook permissions: https://developers.facebook.com/docs/permissions · TikTok embeds: https://developers.tiktok.com/doc/embed-videos
- Wongnai terms: https://www.wongnai.com/terms
