-- What Couch Clash costs (admin page /admin/kosten). Only numbers – never prompts, texts or player data.
-- Measured API calls, summed per UTC day, service and kind.
CREATE TABLE IF NOT EXISTS api_usage (
  day TEXT NOT NULL,
  service TEXT NOT NULL,
  kind TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  -- ElevenLabs credits (their price is in the subscription).
  units INTEGER NOT NULL DEFAULT 0,
  usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, service, kind)
);

-- Fixed monthly costs entered by hand (Claude, ElevenLabs plan, domain, …).
CREATE TABLE IF NOT EXISTS fixed_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  since TEXT NOT NULL,
  until TEXT,
  note TEXT
);
