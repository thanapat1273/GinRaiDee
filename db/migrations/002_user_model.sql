-- Per-user linear Thompson-sampling model (docs/design/02-recommender.md).
-- A = λI + Σ φφᵀ and b = λμ0 + Σ rφ, stored as JSON arrays; the feature list is versioned by policy.
CREATE TABLE user_model (
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  policy     text NOT NULL,
  a          jsonb NOT NULL,
  b          jsonb NOT NULL,
  n          int NOT NULL DEFAULT 0,     -- observations learned from
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, policy)
);
