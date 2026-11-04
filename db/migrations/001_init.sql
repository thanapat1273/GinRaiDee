-- GinRaiDee schema v1. See docs/design/01-data-gathering.md and 02-recommender.md.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- Canonical dish catalogue (seeded from data/dishes.json).
CREATE TABLE dish (
  id          text PRIMARY KEY,                 -- slug, e.g. 'kaprao-moo-saap'
  name_th     text NOT NULL,
  name_en     text NOT NULL,
  aliases     text[] NOT NULL DEFAULT '{}',     -- spellings + shop-name keywords
  parent_id   text REFERENCES dish(id),         -- variant of (e.g. noodle soups)
  base        text NOT NULL,                    -- rice | noodle | none | bread | dessert
  attrs       jsonb NOT NULL,                   -- {salty, fatty, spicy, sweet, sour, clean, heavy, soupy} 0..1
  temp        text NOT NULL DEFAULT 'hot',      -- hot | cold | room
  meals       text[] NOT NULL,                  -- breakfast | lunch | afternoon | dinner | late
  tags        text[] NOT NULL DEFAULT '{}',     -- pork, chicken, beef, seafood, egg, peanut, can_be_jay, ...
  kcal_min    int,
  kcal_max    int,
  embedding   vector(8)                         -- attribute vector, used for "similar but new"
);

-- Shops from Google Places, OpenStreetMap, links and the user.
CREATE TABLE shop (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  geom             geography(Point, 4326),      -- null for delivery-only kitchens
  google_place_id  text UNIQUE,                 -- the only Places field we may keep indefinitely
  osm_id           text UNIQUE,
  kind             text NOT NULL DEFAULT 'restaurant', -- restaurant | stall | food_court | cafe | convenience | delivery_only
  price_level      int,
  business_status  text,                        -- OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  delivery_links   jsonb NOT NULL DEFAULT '{}', -- {grab: url, lineman: url, shopeefood: url}
  maps_url         text,
  source           text NOT NULL,               -- places | osm | user | link
  google_cached_at timestamptz,                 -- Places content older than 30 days must be refreshed
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_geom_idx ON shop USING gist (geom);

-- Which shop serves which dish: the data nobody else has.
CREATE TABLE shop_dish (
  shop_id     uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  dish_id     text NOT NULL REFERENCES dish(id),
  price       int,
  confidence  real NOT NULL,                    -- 0..1; decays without fresh evidence
  source      text NOT NULL,                    -- name_match | user | log | menu_photo | llm
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, dish_id)
);

CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL,
  diet          jsonb NOT NULL DEFAULT '{}',    -- hard rules: {no: ['pork'], jay: false, halal: false, allergies: []}
  persona_id    text NOT NULL DEFAULT 'phuean',
  onboarded_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Long-term taste: per-dish Beta posterior + per-attribute preference.
CREATE TABLE taste (
  user_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  key       text NOT NULL,                      -- 'dish:<id>' or 'attr:<name>'
  alpha     real NOT NULL DEFAULT 1,            -- dish keys: successes + 1
  beta      real NOT NULL DEFAULT 1,            -- dish keys: failures + 1
  value     real NOT NULL DEFAULT 0,            -- attr keys: preference in -1..1
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Every answer we showed, with how likely each item was to be shown (for offline evaluation later).
CREATE TABLE suggestion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  context     jsonb NOT NULL,                   -- time slot, weather, location bucket, constraints, mood shifts
  items       jsonb NOT NULL,                   -- [{rank, dish_id, shop_id, kind, score, propensity, features}]
  policy      text NOT NULL,                    -- ranking policy version, e.g. 'rules-v1'
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id  uuid REFERENCES suggestion(id) ON DELETE SET NULL,
  user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  dish_id        text REFERENCES dish(id),
  shop_id        uuid REFERENCES shop(id) ON DELETE SET NULL,
  action         text NOT NULL,                 -- accept | reject
  reason         text,                          -- too_salty | too_fatty | too_clean | too_spicy | too_heavy | ate_recently | too_far | too_pricey | want_new | other
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meal_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  dish_id     text REFERENCES dish(id),
  dish_text   text NOT NULL,                    -- what the user said, always kept
  origin      text NOT NULL,                    -- place | delivery | homemade | other
  shop_id     uuid REFERENCES shop(id) ON DELETE SET NULL,
  link        text,                             -- Google Maps or delivery-app link the user gave
  via         text NOT NULL,                    -- accept | chat | photo | checkin | form
  confirmed   boolean NOT NULL DEFAULT false,   -- false = provisional (tapped ไปเลย)
  rating      int,                              -- 1..5, optional
  eaten_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meal_log_user_time_idx ON meal_log (user_id, eaten_at DESC);
