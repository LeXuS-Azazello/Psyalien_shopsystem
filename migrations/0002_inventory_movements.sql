CREATE TABLE IF NOT EXISTS inventory_movements (
  movement_id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('receipt', 'sale', 'writeoff', 'adjustment')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta != 0),
  reference TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (movement_type = 'receipt' AND quantity_delta > 0) OR
    (movement_type IN ('sale', 'writeoff') AND quantity_delta < 0) OR
    movement_type = 'adjustment'
  )
);

CREATE INDEX IF NOT EXISTS inventory_movements_product_created_idx
  ON inventory_movements (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inventory_movements_created_idx
  ON inventory_movements (created_at DESC);
