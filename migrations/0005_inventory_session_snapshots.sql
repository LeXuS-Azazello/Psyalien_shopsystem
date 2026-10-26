CREATE TABLE IF NOT EXISTS inventory_session_tags (
  session_id TEXT NOT NULL REFERENCES inventory_sessions(session_id),
  epc TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  PRIMARY KEY (session_id, epc)
);

CREATE TABLE IF NOT EXISTS inventory_session_scan_events (
  session_id TEXT NOT NULL REFERENCES inventory_sessions(session_id),
  event_id TEXT NOT NULL REFERENCES scan_events(event_id),
  PRIMARY KEY (session_id, event_id)
);
