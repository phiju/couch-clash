-- Question statistics (aggregated numbers only – never player names or answers).
CREATE TABLE IF NOT EXISTS question_stats (
  question_id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  answers INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  sum_response_ms INTEGER NOT NULL DEFAULT 0,
  -- Estimates: Σ |answer − correct| / zeroRange, each capped at 1.
  sum_error_pct REAL NOT NULL DEFAULT 0,
  thumbs_up INTEGER NOT NULL DEFAULT 0,
  thumbs_down INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  -- active | quarantined | removed (no row = active)
  status TEXT NOT NULL DEFAULT 'active',
  status_changed_at INTEGER,
  first_played_at INTEGER,
  last_played_at INTEGER
);
CREATE INDEX IF NOT EXISTS question_stats_status ON question_stats (status);

-- AI-generated questions (replacements for removed ones), merged with the static content.
CREATE TABLE IF NOT EXISTS generated_questions (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  replaces_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS generated_questions_category ON generated_questions (category_id);

-- Every replacement job (errors shown in the admin page). Jobs that called
-- the model (model_calls > 0) count towards the daily limit.
CREATE TABLE IF NOT EXISTS generation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  category_id TEXT NOT NULL,
  replaces_id TEXT,
  ok INTEGER NOT NULL,
  model_calls INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
CREATE INDEX IF NOT EXISTS generation_log_created ON generation_log (created_at);
