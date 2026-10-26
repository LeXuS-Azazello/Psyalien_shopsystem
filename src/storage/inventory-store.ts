import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { ScanEvent } from "../integrations/mqtt/scan-event.ts";

export interface Product {
  id: string;
  sku: string;
  name: string;
  price: number;
  createdAt: string;
}

export interface Tag {
  epc: string;
  productId: string;
  createdAt: string;
}

export interface TagAssignmentEvent {
  assignmentId: string;
  epc: string;
  productId: string;
  action: "assigned" | "unassigned";
  occurredAt: string;
}

export interface ScanEventRecord extends ScanEvent {
  ingestedAt: string;
}

export interface InventorySummary {
  productId: string;
  sku: string;
  name: string;
  price: number;
  onHand: number;
  tagCount: number;
  seenTagCount: number;
  lastSeenAt: string | null;
}

export type InventoryMovementType =
  | "receipt"
  | "sale"
  | "writeoff"
  | "adjustment";

export interface InventoryMovement {
  movementId: string;
  productId: string;
  type: InventoryMovementType;
  quantityDelta: number;
  reference?: string;
  note?: string;
  createdAt: string;
}

export interface InventoryReconciliation {
  readerId: string;
  from: string;
  to: string;
  products: Array<{
    productId: string;
    sku: string;
    name: string;
    price: number;
    registeredTagCount: number;
    seenTagCount: number;
    unseenTagCount: number;
    lastSeenAt: string | null;
  }>;
  totals: {
    registeredTagCount: number;
    seenTagCount: number;
    unseenTagCount: number;
    unassignedEpcCount: number;
    unassignedEpcs: string[];
    unassignedListTruncated: boolean;
  };
}

export interface InventorySession {
  sessionId: string;
  readerId: string;
  startedAt: string;
  closedAt: string | null;
}

export interface InventorySessionReport {
  session: InventorySession;
  reconciliation: InventoryReconciliation;
}

export interface InventoryStore {
  listProducts(): Promise<Product[]>;
  createProduct(sku: string, name: string): Promise<Product>;
  updateProduct(id: string, sku: string, name: string): Promise<Product>;
  listInventory(): Promise<InventorySummary[]>;
  listInventoryMovements(
    limit: number,
    productId?: string,
  ): Promise<InventoryMovement[]>;
  recordInventoryMovement(
    movement: Omit<InventoryMovement, "createdAt">,
  ): Promise<{ status: "accepted" | "duplicate"; movement: InventoryMovement }>;
  reconcileInventory(
    readerId: string,
    from: string,
    to: string,
    sessionId?: string,
    useCapturedScanEvents?: boolean,
  ): Promise<InventoryReconciliation>;
  createInventorySession(readerId: string): Promise<InventorySession>;
  listInventorySessions(limit: number): Promise<InventorySession[]>;
  closeInventorySession(
    sessionId: string,
  ): Promise<{ status: "closed" | "already_closed"; session: InventorySession }>;
  getInventorySessionReport(
    sessionId: string,
  ): Promise<InventorySessionReport>;
  listTags(): Promise<Tag[]>;
  listTagHistory(limit: number, epc?: string): Promise<TagAssignmentEvent[]>;
  bindTag(epc: string, productId: string): Promise<Tag>;
  unbindTag(epc: string): Promise<Tag>;
  listScanEvents(limit: number, epc?: string): Promise<ScanEventRecord[]>;
  recordScanEvent(
    event: ScanEvent,
  ): Promise<{ status: "accepted" | "duplicate" }>;
  close(): void;
}

export class StoreError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "StoreError";
    this.status = status;
  }
}

interface SqlRow {
  [key: string]: string | number | null | bigint | Uint8Array;
}

function readMigration(fileName: string): string {
  const candidates = [
    new URL(`../migrations/${fileName}`, import.meta.url),
    new URL(`../../migrations/${fileName}`, import.meta.url),
  ];
  const migrationPath = candidates.find((candidate) => existsSync(candidate));
  if (!migrationPath) {
    throw new Error(`Database migration file was not found: ${fileName}`);
  }
  return readFileSync(migrationPath, "utf8");
}

function toProduct(row: SqlRow): Product {
  return {
    id: String(row["id"]),
    sku: String(row["sku"]),
    name: String(row["name"]),
    price: Number(row["price"] ?? 0),
    createdAt: String(row["created_at"]),
  };
}

function toTag(row: SqlRow): Tag {
  return {
    epc: String(row["epc"]),
    productId: String(row["product_id"]),
    createdAt: String(row["created_at"]),
  };
}

function toTagAssignmentEvent(row: SqlRow): TagAssignmentEvent {
  return {
    assignmentId: String(row["assignment_id"]),
    epc: String(row["epc"]),
    productId: String(row["product_id"]),
    action: String(row["action"]) as TagAssignmentEvent["action"],
    occurredAt: String(row["occurred_at"]),
  };
}

function toInventoryMovement(row: SqlRow): InventoryMovement {
  const movement: InventoryMovement = {
    movementId: String(row["movement_id"]),
    productId: String(row["product_id"]),
    type: String(row["movement_type"]) as InventoryMovementType,
    quantityDelta: Number(row["quantity_delta"]),
    createdAt: String(row["created_at"]),
  };
  if (row["reference"] !== null) {
    movement.reference = String(row["reference"]);
  }
  if (row["note"] !== null) {
    movement.note = String(row["note"]);
  }
  return movement;
}

function toInventorySession(row: SqlRow): InventorySession {
  return {
    sessionId: String(row["session_id"]),
    readerId: String(row["reader_id"]),
    startedAt: String(row["started_at"]),
    closedAt:
      row["closed_at"] === null ? null : String(row["closed_at"]),
  };
}

function toScanEvent(row: SqlRow): ScanEventRecord {
  const event: ScanEventRecord = {
    eventId: String(row["event_id"]),
    epc: String(row["epc"]),
    readerId: String(row["reader_id"]),
    observedAt: String(row["observed_at"]),
    ingestedAt: String(row["ingested_at"]),
  };
  if (row["antenna_id"] !== null) {
    event.antennaId = String(row["antenna_id"]);
  }
  if (row["rssi"] !== null) {
    event.rssi = Number(row["rssi"]);
  }
  return event;
}

function comparableEvent(row: SqlRow, event: ScanEvent): boolean {
  return (
    row["epc"] === event.epc &&
    row["reader_id"] === event.readerId &&
    row["antenna_id"] === (event.antennaId === undefined ? null : String(event.antennaId)) &&
    row["rssi"] === (event.rssi ?? null) &&
    row["observed_at"] === event.observedAt
  );
}

function comparableMovement(
  row: SqlRow,
  movement: Omit<InventoryMovement, "createdAt">,
): boolean {
  return (
    row["product_id"] === movement.productId &&
    row["movement_type"] === movement.type &&
    row["quantity_delta"] === movement.quantityDelta &&
    row["reference"] === (movement.reference ?? null) &&
    row["note"] === (movement.note ?? null)
  );
}

export class SqliteInventoryStore implements InventoryStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    const absolutePath =
      databasePath === ":memory:" ? databasePath : resolve(databasePath);
    if (absolutePath !== ":memory:") {
      mkdirSync(dirname(absolutePath), { recursive: true });
    }

    this.database = new Database(absolutePath);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("journal_mode = WAL");
    this.database.exec(readMigration("0001_initial.sql"));
    this.database
      .prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(1, new Date().toISOString());
    const migrationApplied = this.database
      .prepare("SELECT version FROM schema_migrations WHERE version = ?")
      .get(2);
    if (!migrationApplied) {
      this.database.transaction(() => {
        this.database.exec(readMigration("0002_inventory_movements.sql"));
        this.database
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          )
          .run(2, new Date().toISOString());
      })();
    }
    const tagHistoryMigrationApplied = this.database
      .prepare("SELECT version FROM schema_migrations WHERE version = ?")
      .get(3);
    if (!tagHistoryMigrationApplied) {
      this.database.transaction(() => {
        this.database.exec(readMigration("0003_tag_assignment_history.sql"));
        this.database
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          )
          .run(3, new Date().toISOString());
      })();
    }
    const inventorySessionMigrationApplied = this.database
      .prepare("SELECT version FROM schema_migrations WHERE version = ?")
      .get(4);
    if (!inventorySessionMigrationApplied) {
      this.database.transaction(() => {
        this.database.exec(readMigration("0004_inventory_sessions.sql"));
        this.database
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          )
          .run(4, new Date().toISOString());
      })();
    }
    const inventorySessionSnapshotsMigrationApplied = this.database
      .prepare("SELECT version FROM schema_migrations WHERE version = ?")
      .get(5);
    if (!inventorySessionSnapshotsMigrationApplied) {
      this.database.transaction(() => {
        this.database.exec(
          readMigration("0005_inventory_session_snapshots.sql"),
        );
        this.database
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          )
          .run(5, new Date().toISOString());
      })();
    }
    const productPriceMigrationApplied = this.database
      .prepare("SELECT version FROM schema_migrations WHERE version = ?")
      .get(6);
    if (!productPriceMigrationApplied) {
      this.database.transaction(() => {
        this.database.exec(readMigration("0006_product_price.sql"));
        this.database
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          )
          .run(6, new Date().toISOString());
      })();
    }
  }

  async listProducts(): Promise<Product[]> {
    return this.database
      .prepare("SELECT id, sku, name, price, created_at FROM products ORDER BY sku")
      .all()
      .map((row) => toProduct(row as SqlRow));
  }

  async createProduct(sku: string, name: string, price = 0): Promise<Product> {
    const existing = this.database
      .prepare("SELECT id FROM products WHERE sku = ?")
      .get(sku);
    if (existing) {
      throw new StoreError("A product with this SKU already exists", 409);
    }

    const product: Product = {
      id: randomUUID(),
      sku,
      name,
      price,
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare(
        "INSERT INTO products (id, sku, name, price, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(product.id, product.sku, product.name, product.price, product.createdAt);
    return product;
  }

  async updateProduct(id: string, sku: string, name: string, price = 0): Promise<Product> {
    const existing = this.database
      .prepare("SELECT id, sku, name, price, created_at FROM products WHERE id = ?")
      .get(id) as SqlRow | undefined;
    if (!existing) {
      throw new StoreError("Product not found", 404);
    }

    const duplicateSku = this.database
      .prepare("SELECT id FROM products WHERE sku = ? AND id != ?")
      .get(sku, id);
    if (duplicateSku) {
      throw new StoreError("A product with this SKU already exists", 409);
    }

    this.database
      .prepare("UPDATE products SET sku = ?, name = ?, price = ? WHERE id = ?")
      .run(sku, name, price, id);
    return {
      id,
      sku,
      name,
      price,
      createdAt: String(existing["created_at"]),
    };
  }

  async listInventory(): Promise<InventorySummary[]> {
    return this.database
      .prepare(
        `SELECT
           p.id AS product_id,
           p.sku,
           p.name,
           p.price AS price,
           COALESCE(m.on_hand, 0) AS on_hand,
           COUNT(DISTINCT t.epc) AS tag_count,
           COUNT(DISTINCT CASE WHEN s.event_id IS NOT NULL THEN t.epc END) AS seen_tag_count,
           MAX(s.observed_at) AS last_seen_at
         FROM products p
         LEFT JOIN tags t ON t.product_id = p.id
         LEFT JOIN scan_events s ON s.epc = t.epc
         LEFT JOIN (
           SELECT product_id, SUM(quantity_delta) AS on_hand
           FROM inventory_movements
           GROUP BY product_id
         ) m ON m.product_id = p.id
         GROUP BY p.id
         ORDER BY p.sku`,
      )
      .all()
      .map((row) => {
        const summary = row as SqlRow;
        return {
          productId: String(summary["product_id"]),
          sku: String(summary["sku"]),
          name: String(summary["name"]),
          price: Number(summary["price"] ?? 0),
          onHand: Number(summary["on_hand"]),
          tagCount: Number(summary["tag_count"]),
          seenTagCount: Number(summary["seen_tag_count"]),
          lastSeenAt:
            summary["last_seen_at"] === null
              ? null
              : String(summary["last_seen_at"]),
        };
      });
  }

  async listInventoryMovements(
    limit: number,
    productId?: string,
  ): Promise<InventoryMovement[]> {
    const statement = productId
      ? this.database.prepare(
          `SELECT * FROM inventory_movements
           WHERE product_id = ?
           ORDER BY created_at DESC, movement_id DESC
           LIMIT ?`,
        )
      : this.database.prepare(
          `SELECT * FROM inventory_movements
           ORDER BY created_at DESC, movement_id DESC
           LIMIT ?`,
        );
    const rows = productId
      ? statement.all(productId, limit)
      : statement.all(limit);
    return rows.map((row) => toInventoryMovement(row as SqlRow));
  }

  async recordInventoryMovement(
    movement: Omit<InventoryMovement, "createdAt">,
  ): Promise<{ status: "accepted" | "duplicate"; movement: InventoryMovement }> {
    const insertMovement = this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT * FROM inventory_movements WHERE movement_id = ?")
        .get(movement.movementId) as SqlRow | undefined;
      if (existing) {
        if (!comparableMovement(existing, movement)) {
          throw new StoreError(
            "movementId was already used for a different inventory movement",
            409,
          );
        }
        return {
          status: "duplicate" as const,
          movement: toInventoryMovement(existing),
        };
      }

      const product = this.database
        .prepare("SELECT id FROM products WHERE id = ?")
        .get(movement.productId);
      if (!product) {
        throw new StoreError("Product was not found", 404);
      }

      const current = this.database
        .prepare(
          `SELECT COALESCE(SUM(quantity_delta), 0) AS on_hand
           FROM inventory_movements
           WHERE product_id = ?`,
        )
        .get(movement.productId) as SqlRow;
      if (Number(current["on_hand"]) + movement.quantityDelta < 0) {
        throw new StoreError("Inventory movement would make stock negative", 409);
      }

      const createdAt = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO inventory_movements
             (movement_id, product_id, movement_type, quantity_delta, reference, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          movement.movementId,
          movement.productId,
          movement.type,
          movement.quantityDelta,
          movement.reference ?? null,
          movement.note ?? null,
          createdAt,
        );
      return {
        status: "accepted" as const,
        movement: { ...movement, createdAt },
      };
    });
    return insertMovement();
  }

  async reconcileInventory(
    readerId: string,
    from: string,
    to: string,
    sessionId?: string,
    useCapturedScanEvents = false,
  ): Promise<InventoryReconciliation> {
    const registeredTagsQuery = sessionId
      ? "SELECT epc, product_id FROM inventory_session_tags WHERE session_id = ?"
      : "SELECT epc, product_id FROM tags";
    const scanSnapshotJoin =
      sessionId && useCapturedScanEvents
        ? "JOIN inventory_session_scan_events captured ON captured.event_id = s.event_id AND captured.session_id = ?"
        : "";
    const scanWindowFilter =
      sessionId && useCapturedScanEvents
        ? ""
        : "AND s.observed_at >= ? AND s.observed_at <= ?";
    const registeredTagsParameters = sessionId ? [sessionId] : [];
    const scanParameters =
      sessionId && useCapturedScanEvents
        ? [sessionId, readerId]
        : [readerId, from, to];
    const queryParameters = [
      ...registeredTagsParameters,
      ...scanParameters,
    ];
    const products = this.database
      .prepare(
        `WITH registered_tags AS (${registeredTagsQuery}),
         reader_scans AS (
           SELECT s.epc, MAX(s.observed_at) AS last_seen_at
           FROM scan_events s
           ${scanSnapshotJoin}
           WHERE s.reader_id = ?
             ${scanWindowFilter}
           GROUP BY epc
         )
         SELECT
           p.id AS product_id,
           p.sku,
           p.name,
           p.price AS price,
           COUNT(DISTINCT t.epc) AS registered_tag_count,
           COUNT(DISTINCT CASE WHEN rs.epc IS NOT NULL THEN t.epc END) AS seen_tag_count,
           MAX(rs.last_seen_at) AS last_seen_at
         FROM products p
         LEFT JOIN registered_tags t ON t.product_id = p.id
         LEFT JOIN reader_scans rs ON rs.epc = t.epc
         GROUP BY p.id
         ORDER BY p.sku`,
      )
      .all(...queryParameters)
      .map((row) => {
        const result = row as SqlRow;
        const registeredTagCount = Number(result["registered_tag_count"]);
        const seenTagCount = Number(result["seen_tag_count"]);
        return {
          productId: String(result["product_id"]),
          sku: String(result["sku"]),
          name: String(result["name"]),
          price: Number(result["price"] ?? 0),
          registeredTagCount,
          seenTagCount,
          unseenTagCount: registeredTagCount - seenTagCount,
          lastSeenAt:
            result["last_seen_at"] === null
              ? null
              : String(result["last_seen_at"]),
        };
      });

    const tagTotals = products.reduce(
      (totals, product) => ({
        registeredTagCount:
          totals.registeredTagCount + product.registeredTagCount,
        seenTagCount: totals.seenTagCount + product.seenTagCount,
        unseenTagCount: totals.unseenTagCount + product.unseenTagCount,
      }),
      { registeredTagCount: 0, seenTagCount: 0, unseenTagCount: 0 },
    );
    const unassignedEpcCountQuery = this.database
      .prepare(
        `WITH registered_tags AS (${registeredTagsQuery})
         SELECT COUNT(*) AS count
             FROM (
               SELECT s.epc
               FROM scan_events s
               ${scanSnapshotJoin}
               LEFT JOIN registered_tags t ON t.epc = s.epc
               WHERE s.reader_id = ?
                 ${scanWindowFilter}
                 AND t.epc IS NULL
               GROUP BY s.epc
             )`,
      );
    const unassignedEpcCount = Number(
      (unassignedEpcCountQuery.get(...queryParameters) as SqlRow)["count"],
    );
    const unassignedEpcs = this.database
      .prepare(
        `WITH registered_tags AS (${registeredTagsQuery})
         SELECT s.epc
         FROM scan_events s
         ${scanSnapshotJoin}
         LEFT JOIN registered_tags t ON t.epc = s.epc
         WHERE s.reader_id = ?
           ${scanWindowFilter}
           AND t.epc IS NULL
         GROUP BY s.epc
         ORDER BY s.epc
         LIMIT 100`,
      )
      .all(...queryParameters)
      .map((row) => String((row as SqlRow)["epc"]));

    return {
      readerId,
      from,
      to,
      products,
      totals: {
        ...tagTotals,
        unassignedEpcCount,
        unassignedEpcs,
        unassignedListTruncated: unassignedEpcCount > unassignedEpcs.length,
      },
    };
  }

  async createInventorySession(readerId: string): Promise<InventorySession> {
    return this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT session_id FROM inventory_sessions WHERE reader_id = ? AND closed_at IS NULL",
        )
        .get(readerId);
      if (existing) {
        throw new StoreError(
          "This reader already has an open inventory session",
          409,
        );
      }

      const session: InventorySession = {
        sessionId: randomUUID(),
        readerId,
        startedAt: new Date().toISOString(),
        closedAt: null,
      };
      this.database
        .prepare(
          `INSERT INTO inventory_sessions
             (session_id, reader_id, started_at, closed_at)
           VALUES (?, ?, ?, NULL)`,
        )
        .run(session.sessionId, session.readerId, session.startedAt);
      this.snapshotSessionTags(session.sessionId);
      return session;
    })();
  }

  snapshotSessionTags(sessionId: string): void {
    this.database
      .prepare(
        `INSERT INTO inventory_session_tags (session_id, epc, product_id)
         SELECT ?, epc, product_id FROM tags`,
      )
      .run(sessionId);
  }

  snapshotSessionScanEvents(
    sessionId: string,
    readerId: string,
    startedAt: string,
    closedAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO inventory_session_scan_events (session_id, event_id)
         SELECT ?, event_id
         FROM scan_events
         WHERE reader_id = ?
           AND observed_at >= ?
           AND observed_at <= ?`,
      )
      .run(sessionId, readerId, startedAt, closedAt);
  }

  async listInventorySessions(limit: number): Promise<InventorySession[]> {
    return this.database
      .prepare(
        `SELECT * FROM inventory_sessions
         ORDER BY started_at DESC, session_id DESC
         LIMIT ?`,
      )
      .all(limit)
      .map((row) => toInventorySession(row as SqlRow));
  }

  async closeInventorySession(
    sessionId: string,
  ): Promise<{ status: "closed" | "already_closed"; session: InventorySession }> {
    return this.database.transaction(() => {
      const row = this.database
        .prepare("SELECT * FROM inventory_sessions WHERE session_id = ?")
        .get(sessionId) as SqlRow | undefined;
      if (!row) {
        throw new StoreError("Inventory session was not found", 404);
      }
      const existing = toInventorySession(row);
      if (existing.closedAt !== null) {
        return { status: "already_closed" as const, session: existing };
      }

      const closedAt = new Date().toISOString();
      this.snapshotSessionScanEvents(
        sessionId,
        existing.readerId,
        existing.startedAt,
        closedAt,
      );
      this.database
        .prepare(
          "UPDATE inventory_sessions SET closed_at = ? WHERE session_id = ? AND closed_at IS NULL",
        )
        .run(closedAt, sessionId);
      return {
        status: "closed" as const,
        session: { ...existing, closedAt },
      };
    })();
  }

  async getInventorySessionReport(
    sessionId: string,
  ): Promise<InventorySessionReport> {
    const row = this.database
      .prepare("SELECT * FROM inventory_sessions WHERE session_id = ?")
      .get(sessionId) as SqlRow | undefined;
    if (!row) {
      throw new StoreError("Inventory session was not found", 404);
    }
    const session = toInventorySession(row);
    return {
      session,
      reconciliation: await this.reconcileInventory(
        session.readerId,
        session.startedAt,
        session.closedAt ?? new Date().toISOString(),
        session.sessionId,
        session.closedAt !== null,
      ),
    };
  }

  async listTags(): Promise<Tag[]> {
    return this.database
      .prepare("SELECT epc, product_id, created_at FROM tags ORDER BY epc")
      .all()
      .map((row) => toTag(row as SqlRow));
  }

  async listTagHistory(
    limit: number,
    epc?: string,
  ): Promise<TagAssignmentEvent[]> {
    const statement = epc
      ? this.database.prepare(
          `SELECT * FROM tag_assignment_history
           WHERE epc = ?
           ORDER BY occurred_at DESC, rowid DESC
           LIMIT ?`,
        )
      : this.database.prepare(
          `SELECT * FROM tag_assignment_history
           ORDER BY occurred_at DESC, rowid DESC
           LIMIT ?`,
        );
    const rows = epc
      ? statement.all(epc, limit)
      : statement.all(limit);
    return rows.map((row) => toTagAssignmentEvent(row as SqlRow));
  }

  async bindTag(epc: string, productId: string): Promise<Tag> {
    return this.database.transaction(() => {
      const product = this.database
        .prepare("SELECT id FROM products WHERE id = ?")
        .get(productId);
      if (!product) {
        throw new StoreError("Product was not found", 404);
      }
      const existingTag = this.database
        .prepare("SELECT epc FROM tags WHERE epc = ?")
        .get(epc);
      if (existingTag) {
        throw new StoreError("This EPC is already assigned to a product", 409);
      }

      const createdAt = new Date().toISOString();
      const tag: Tag = { epc, productId, createdAt };
      this.database
        .prepare("INSERT INTO tags (epc, product_id, created_at) VALUES (?, ?, ?)")
        .run(tag.epc, tag.productId, tag.createdAt);
      this.database
        .prepare(
          `INSERT INTO tag_assignment_history
             (assignment_id, epc, product_id, action, occurred_at)
           VALUES (?, ?, ?, 'assigned', ?)`,
        )
        .run(randomUUID(), epc, productId, createdAt);
      return tag;
    })();
  }

  async unbindTag(epc: string): Promise<Tag> {
    return this.database.transaction(() => {
      const existingTag = this.database
        .prepare("SELECT epc, product_id, created_at FROM tags WHERE epc = ?")
        .get(epc) as SqlRow | undefined;
      if (!existingTag) {
        throw new StoreError("This EPC is not assigned to a product", 404);
      }

      const tag = toTag(existingTag);
      const occurredAt = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO tag_assignment_history
             (assignment_id, epc, product_id, action, occurred_at)
           VALUES (?, ?, ?, 'unassigned', ?)`,
        )
        .run(randomUUID(), epc, tag.productId, occurredAt);
      this.database.prepare("DELETE FROM tags WHERE epc = ?").run(epc);
      return tag;
    })();
  }

  async listScanEvents(
    limit: number,
    epc?: string,
  ): Promise<ScanEventRecord[]> {
    const statement = epc
      ? this.database.prepare(
          "SELECT * FROM scan_events WHERE epc = ? ORDER BY observed_at DESC LIMIT ?",
        )
      : this.database.prepare(
          "SELECT * FROM scan_events ORDER BY observed_at DESC LIMIT ?",
        );
    const params = epc ? [epc, limit] : [limit];
    return statement
      .all(...params)
      .map((row) => toScanEvent(row as SqlRow));
  }

  async recordScanEvent(
    event: ScanEvent,
  ): Promise<{ status: "accepted" | "duplicate" }> {
    const existing = this.database
      .prepare("SELECT * FROM scan_events WHERE event_id = ?")
      .get(event.eventId) as SqlRow | undefined;
    if (existing) {
      if (!comparableEvent(existing, event)) {
        throw new StoreError(
          "eventId was already used for a different scan event",
          409,
        );
      }
      return { status: "duplicate" };
    }

    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO scan_events
          (event_id, epc, reader_id, antenna_id, rssi, observed_at, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const result = insert.run(
        event.eventId,
        event.epc,
        event.readerId,
        event.antennaId === undefined ? null : String(event.antennaId),
        event.rssi ?? null,
        event.observedAt,
        new Date().toISOString(),
      );
    if (result.changes === 0) {
      const duplicate = this.database
        .prepare("SELECT * FROM scan_events WHERE event_id = ?")
        .get(event.eventId) as SqlRow | undefined;
      if (duplicate && comparableEvent(duplicate, event)) {
        return { status: "duplicate" };
      }
      throw new StoreError(
        "eventId was already used for a different scan event",
        409,
      );
    }

    this.ensureTagRegistered(event.epc);

    return { status: "accepted" };
  }

  ensureTagRegistered(epc: string): void {
    const existing = this.database
      .prepare("SELECT epc FROM tags WHERE epc = ?")
      .get(epc);
    if (existing) return;

    const suffix = epc.slice(-8);
    const sku = `RFID-${suffix}`;
    const name = `Tag ${suffix}`;
    const productId = randomUUID();
    const createdAt = new Date().toISOString();

    this.database.transaction(() => {
      this.database
        .prepare(
          "INSERT OR IGNORE INTO products (id, sku, name, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(productId, sku, name, createdAt);
      this.database
        .prepare(
          "INSERT OR IGNORE INTO tags (epc, product_id, created_at) VALUES (?, ?, ?)",
        )
        .run(epc, productId, createdAt);
      this.database
        .prepare(
          `INSERT INTO tag_assignment_history
             (assignment_id, epc, product_id, action, occurred_at)
           VALUES (?, ?, ?, 'assigned', ?)`,
        )
        .run(randomUUID(), epc, productId, createdAt);
    })();
  }

  close(): void {
    this.database.close();
  }
}
