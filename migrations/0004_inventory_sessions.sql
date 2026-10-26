CREATE TABLE IF NOT EXISTS inventory_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  reader_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  closed_at TEXT,
  CHECK (closed_at IS NULL OR closed_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_sessions_one_open_reader_idx
  ON inventory_sessions (reader_id)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS inventory_sessions_started_idx
  ON inventory_sessions (started_at DESC);
