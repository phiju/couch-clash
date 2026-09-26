-- Musik-Quiz: corrections from /admin/songs (year, verified, aliases, disabled) on top of songs.json.
CREATE TABLE IF NOT EXISTS song_overrides (
  song_id TEXT PRIMARY KEY,
  -- SongOverrideSchema as JSON (only the changed fields).
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
