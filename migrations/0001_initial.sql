CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  epc TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  epc TEXT NOT NULL,
  reader_id TEXT NOT NULL,
  antenna_id TEXT,
  rssi REAL,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS scan_events_epc_observed_at_idx
  ON scan_events (epc, observed_at DESC);

CREATE INDEX IF NOT EXISTS scan_events_observed_at_idx
  ON scan_events (observed_at DESC);
