import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteInventoryStore, StoreError } from "../../src/storage/inventory-store.ts";
import { parseScanEvent } from "../../src/integrations/mqtt/scan-event.ts";

const scanEvent = parseScanEvent(
  Buffer.from(
    JSON.stringify({
      eventId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      epc: "e28068940000502c6fe3bcae",
      readerId: "gateway-01",
      antennaId: 1,
      rssi: -54,
      observedAt: "2026-10-26T02:30:00Z",
    }),
  ),
);

test("stores products, tag mappings, and idempotent scan events in SQLite", async () => {
  const store = new SqliteInventoryStore(":memory:");
  try {
    const product = await store.createProduct("SKU-001", "Sample product");
    assert.equal((await store.listProducts()).length, 1);

    await assert.rejects(
      store.createProduct("SKU-001", "Duplicate SKU"),
      (error: unknown) =>
        error instanceof StoreError && error.status === 409,
    );

    const tag = await store.bindTag(scanEvent.epc, product.id);
    assert.equal(tag.productId, product.id);
    assert.equal((await store.listTags()).length, 1);

    assert.deepEqual(await store.listInventory(), [
      {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        price: 0,
        onHand: 0,
        tagCount: 1,
        seenTagCount: 0,
        lastSeenAt: null,
      },
    ]);

    assert.deepEqual(await store.recordScanEvent(scanEvent), { status: "accepted" });
    assert.deepEqual(await store.recordScanEvent(scanEvent), { status: "duplicate" });
    assert.equal((await store.listScanEvents(10)).length, 1);
    assert.equal((await store.listScanEvents(10, scanEvent.epc)).length, 1);
    assert.deepEqual(await store.listInventory(), [
      {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        price: 0,
        onHand: 0,
        tagCount: 1,
        seenTagCount: 1,
        lastSeenAt: scanEvent.observedAt,
      },
    ]);

    await assert.rejects(
      store.recordScanEvent({
          ...scanEvent,
          readerId: "different-reader",
        }),
      (error: unknown) =>
        error instanceof StoreError && error.status === 409,
    );
  } finally {
    store.close();
  }
});

test("updates product details without replacing its identity or creation time", async () => {
  const store = new SqliteInventoryStore(":memory:");
  try {
    const product = await store.createProduct("SKU-EDIT-1", "Original name");
    const updated = await store.updateProduct(product.id, "SKU-EDIT-2", "Updated name");

    assert.deepEqual(updated, {
      ...product,
      sku: "SKU-EDIT-2",
      name: "Updated name",
    });
    assert.deepEqual(await store.listProducts(), [updated]);

    const duplicate = await store.createProduct("SKU-EDIT-3", "Another product");
    await assert.rejects(
      store.updateProduct(product.id, duplicate.sku, "Name collision"),
      (error: unknown) =>
        error instanceof StoreError && error.status === 409,
    );
    await assert.rejects(
      store.updateProduct("00000000-0000-4000-8000-000000000000", "SKU-MISSING", "Missing"),
      (error: unknown) =>
        error instanceof StoreError && error.status === 404,
    );
    assert.deepEqual(await store.listProducts(), [updated, duplicate]);
  } finally {
    store.close();
  }
});

test("records idempotent inventory movements and prevents negative stock", async () => {
  const store = new SqliteInventoryStore(":memory:");
  try {
    const product = await store.createProduct("SKU-002", "Stocked product");
    const receipt = {
      movementId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12",
      productId: product.id,
      type: "receipt" as const,
      quantityDelta: 5,
      reference: "delivery-001",
    };

    assert.equal(
      (await store.recordInventoryMovement(receipt)).status,
      "accepted",
    );
    assert.equal(
      (await store.recordInventoryMovement(receipt)).status,
      "duplicate",
    );
    assert.equal((await store.listInventory())[0]?.onHand, 5);

    const sale = {
      movementId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13",
      productId: product.id,
      type: "sale" as const,
      quantityDelta: -2,
    };
    assert.equal(
      (await store.recordInventoryMovement(sale)).status,
      "accepted",
    );
    assert.equal((await store.listInventory())[0]?.onHand, 3);
    assert.equal((await store.listInventoryMovements(10)).length, 2);
    assert.equal(
      (await store.listInventoryMovements(10, product.id)).length,
      2,
    );

    await assert.rejects(
      store.recordInventoryMovement({
        ...sale,
        quantityDelta: -1,
      }),
      (error: unknown) =>
        error instanceof StoreError && error.status === 409,
    );
    await assert.rejects(
      store.recordInventoryMovement({
        movementId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14",
        productId: product.id,
        type: "writeoff",
        quantityDelta: -4,
      }),
      (error: unknown) =>
        error instanceof StoreError && error.status === 409,
    );
    assert.equal((await store.listInventory())[0]?.onHand, 3);
  } finally {
    store.close();
  }
});

test("upgrades an existing version 1 database without losing products", async () => {
  const directory = mkdtempSync(join(tmpdir(), "psyalien-inventory-migration-"));
  const databasePath = join(directory, "existing.sqlite");
  const oldDatabase = new Database(databasePath);
  try {
    oldDatabase.exec(
      readFileSync(new URL("../../migrations/0001_initial.sql", import.meta.url), "utf8"),
    );
    oldDatabase
      .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(1, "2026-01-01T00:00:00.000Z");
    oldDatabase
      .prepare(
        "INSERT INTO products (id, sku, name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("existing-product", "SKU-OLD", "Existing product", "2026-01-01T00:00:00.000Z");
    oldDatabase
      .prepare(
        "INSERT INTO tags (epc, product_id, created_at) VALUES (?, ?, ?)",
      )
      .run(
        "E28068940000502C6FE3BCAE",
        "existing-product",
        "2026-01-01T00:00:00.000Z",
      );
  } finally {
    oldDatabase.close();
  }

  try {
    const store = new SqliteInventoryStore(databasePath);
    try {
      assert.deepEqual(await store.listInventory(), [
        {
          productId: "existing-product",
          sku: "SKU-OLD",
          name: "Existing product",
          price: 0,
          onHand: 0,
          tagCount: 1,
          seenTagCount: 0,
          lastSeenAt: null,
        },
      ]);
      assert.deepEqual(
        (await store.listTagHistory(10)).map(({ action, epc }) => ({
          action,
          epc,
        })),
        [{ action: "assigned", epc: "E28068940000502C6FE3BCAE" }],
      );
    } finally {
      store.close();
    }

    const upgradedDatabase = new Database(databasePath);
    try {
      assert.ok(
        upgradedDatabase
          .prepare("SELECT version FROM schema_migrations WHERE version = 2")
          .get(),
      );
      assert.ok(
        upgradedDatabase
          .prepare("SELECT version FROM schema_migrations WHERE version = 3")
          .get(),
      );
      assert.ok(
        upgradedDatabase
          .prepare("SELECT version FROM schema_migrations WHERE version = 4")
          .get(),
      );
      assert.ok(
        upgradedDatabase
          .prepare("SELECT version FROM schema_migrations WHERE version = 5")
          .get(),
      );
    } finally {
      upgradedDatabase.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("inventory sessions are reader-scoped, close idempotently, and keep a fixed window", async () => {
  const store = new SqliteInventoryStore(":memory:");
  try {
    const product = await store.createProduct("SKU-SESSION", "Session product");
    const epc = "E28068940000502C6FE3BCAE";
    await store.bindTag(epc, product.id);

    const session = await store.createInventorySession("stocktake-reader");
    assert.equal(session.closedAt, null);
    await assert.rejects(
      store.createInventorySession("stocktake-reader"),
      (error: unknown) =>
        error instanceof StoreError && error.status === 409,
    );
    const otherReaderSession =
      await store.createInventorySession("other-stocktake-reader");
    assert.notEqual(otherReaderSession.sessionId, session.sessionId);

    await store.recordScanEvent({
      eventId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      epc,
      readerId: "stocktake-reader",
      observedAt: session.startedAt,
    });
    const closed = await store.closeInventorySession(session.sessionId);
    assert.equal(closed.status, "closed");
    assert.notEqual(closed.session.closedAt, null);

    const report = await store.getInventorySessionReport(session.sessionId);
    assert.equal(report.reconciliation.readerId, "stocktake-reader");
    assert.equal(report.reconciliation.from, session.startedAt);
    assert.equal(report.reconciliation.to, closed.session.closedAt);
    assert.equal(report.reconciliation.totals.seenTagCount, 1);
    await store.unbindTag(epc);
    const newProduct = await store.createProduct(
      "SKU-SESSION-LATE",
      "Added after session start",
    );
    await store.bindTag("E28068940000502C6FE3BCAD", newProduct.id);
    await store.recordScanEvent({
      eventId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12",
      epc: "E28068940000502C6FE3BCAD",
      readerId: "stocktake-reader",
      observedAt: session.startedAt,
    });
    const immutableReport =
      await store.getInventorySessionReport(session.sessionId);
    assert.equal(immutableReport.reconciliation.totals.registeredTagCount, 1);
    assert.equal(immutableReport.reconciliation.totals.seenTagCount, 1);
    assert.equal(immutableReport.reconciliation.totals.unassignedEpcCount, 0);
    assert.equal(
      (await store.closeInventorySession(session.sessionId)).status,
      "already_closed",
    );
    assert.equal((await store.listInventorySessions(10)).length, 2);
  } finally {
    store.close();
  }
});

test("requires the product to exist before binding a tag", async () => {
  const store = new SqliteInventoryStore(":memory:");
  try {
    await assert.rejects(
      store.bindTag(scanEvent.epc, "missing-product"),
      (error: unknown) =>
        error instanceof StoreError && error.status === 404,
    );
  } finally {
    store.close();
  }
});

test("preserves tag assignment history when a tag is unbound and reassigned", async () => {
  const store = new SqliteInventoryStore(":memory:");
  try {
    const firstProduct = await store.createProduct("SKU-TAG-1", "First product");
    const secondProduct = await store.createProduct("SKU-TAG-2", "Second product");
    const epc = "E28068940000502C6FE3BCAE";

    await store.bindTag(epc, firstProduct.id);
    const removedTag = await store.unbindTag(epc);
    assert.equal(removedTag.productId, firstProduct.id);
    assert.deepEqual(await store.listTags(), []);
    await assert.rejects(
      store.unbindTag(epc),
      (error: unknown) =>
        error instanceof StoreError && error.status === 404,
    );

    await store.bindTag(epc, secondProduct.id);
    assert.equal((await store.listTags())[0]?.productId, secondProduct.id);
    const history = await store.listTagHistory(10, epc);
    assert.deepEqual(
      history.map(({ productId, action }) => ({ productId, action })),
      [
        { productId: secondProduct.id, action: "assigned" },
        { productId: firstProduct.id, action: "unassigned" },
        { productId: firstProduct.id, action: "assigned" },
      ],
    );
  } finally {
    store.close();
  }
});
