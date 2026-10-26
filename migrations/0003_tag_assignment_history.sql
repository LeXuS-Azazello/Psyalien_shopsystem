CREATE TABLE IF NOT EXISTS tag_assignment_history (
  assignment_id TEXT PRIMARY KEY NOT NULL,
  epc TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  action TEXT NOT NULL CHECK (action IN ('assigned', 'unassigned')),
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tag_assignment_history_epc_occurred_idx
  ON tag_assignment_history (epc, occurred_at DESC);

CREATE INDEX IF NOT EXISTS tag_assignment_history_occurred_idx
  ON tag_assignment_history (occurred_at DESC);

INSERT INTO tag_assignment_history
  (assignment_id, epc, product_id, action, occurred_at)
SELECT
  'legacy-' || epc || '-' || created_at,
  epc,
  product_id,
  'assigned',
  created_at
FROM tags
WHERE NOT EXISTS (
  SELECT 1
  FROM tag_assignment_history history
  WHERE history.epc = tags.epc
    AND history.product_id = tags.product_id
    AND history.action = 'assigned'
);
