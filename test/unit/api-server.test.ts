import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createApiServer } from "../../src/http/api-server.ts";
import { SqliteInventoryStore } from "../../src/storage/inventory-store.ts";

test("exposes own product, tag, and scan-event API", async (context) => {
  const store = new SqliteInventoryStore(":memory:");
  const server = createApiServer(store);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    store.close();
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const createdProduct = await fetch(`${baseUrl}/api/v1/products`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: "SKU-001", name: "Sample product" }),
  });

  test("requires a bearer token when API authentication is configured", async (context) => {
    const store = new SqliteInventoryStore(":memory:");
    const token = "a".repeat(32);
    const server = createApiServer(store, token);
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    context.after(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      store.close();
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);

    const unauthorized = await fetch(`${baseUrl}/api/v1/products`);
    assert.equal(unauthorized.status, 401);
    const authorized = await fetch(`${baseUrl}/api/v1/products`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(authorized.status, 200);
  });
  assert.equal(createdProduct.status, 201);
  const productPayload = (await createdProduct.json()) as {
    data: { id: string; sku: string };
  };

  const createdTag = await fetch(`${baseUrl}/api/v1/tags`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      epc: "e28068940000502c6fe3bcae",
      productId: productPayload.data.id,
    }),
  });
  assert.equal(createdTag.status, 201);
  assert.equal(
    ((await createdTag.json()) as { data: { epc: string } }).data.epc,
    "E28068940000502C6FE3BCAE",
  );

  const inventory = await fetch(`${baseUrl}/api/v1/inventory`);
  assert.equal(inventory.status, 200);
  assert.deepEqual(
    (await inventory.json()) as {
      data: Array<{
        sku: string;
        tagCount: number;
        seenTagCount: number;
        onHand: number;
        lastSeenAt: string | null;
      }>;
    },
    {
      data: [
        {
          productId: productPayload.data.id,
          sku: "SKU-001",
          name: "Sample product",
          onHand: 0,
          tagCount: 1,
          seenTagCount: 0,
          lastSeenAt: null,
        },
      ],
    },
  );

  const scan = {
    eventId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    epc: "E28068940000502C6FE3BCAE",
    readerId: "gateway-01",
    observedAt: "2026-10-26T02:30:00Z",
  };
  const firstScan = await fetch(`${baseUrl}/api/v1/scan-events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scan),
  });
  assert.equal(firstScan.status, 202);
  const duplicateScan = await fetch(`${baseUrl}/api/v1/scan-events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scan),
  });
  assert.equal(duplicateScan.status, 200);

  const scans = await fetch(`${baseUrl}/api/v1/scan-events?epc=${scan.epc}`);
  assert.equal(
    ((await scans.json()) as { data: unknown[] }).data.length,
    1,
  );
  const inventoryAfterScan = await fetch(`${baseUrl}/api/v1/inventory`);
  assert.deepEqual(
    (
      (await inventoryAfterScan.json()) as {
        data: Array<{
          productId: string;
          sku: string;
          name: string;
          onHand: number;
          tagCount: number;
          seenTagCount: number;
          lastSeenAt: string | null;
        }>;
      }
    ).data[0],
    {
      productId: productPayload.data.id,
      sku: "SKU-001",
      name: "Sample product",
      onHand: 0,
      tagCount: 1,
      seenTagCount: 1,
      lastSeenAt: "2026-10-26T02:30:00.000Z",
    },
  );
});

test("records inventory movements through the API and rejects invalid stock changes", async (context) => {
  const store = new SqliteInventoryStore(":memory:");
  const server = createApiServer(store);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    store.close();
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const productResponse = await fetch(`${baseUrl}/api/v1/products`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: "SKU-MOVE", name: "Movement test" }),
  });
  const product = (await productResponse.json()) as {
    data: { id: string };
  };
  const receipt = {
    movementId: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    productId: product.data.id,
    type: "receipt",
    quantityDelta: 4,
    reference: "delivery-42",
  };
  const firstReceipt = await fetch(`${baseUrl}/api/v1/inventory/movements`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(receipt),
  });
  assert.equal(firstReceipt.status, 201);
  assert.equal(
    ((await firstReceipt.json()) as { data: { status: string } }).data.status,
    "accepted",
  );
  const repeatedReceipt = await fetch(
    `${baseUrl}/api/v1/inventory/movements`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(receipt),
    },
  );
  assert.equal(repeatedReceipt.status, 200);
  assert.equal(
    ((await repeatedReceipt.json()) as { data: { status: string } }).data
      .status,
    "duplicate",
  );

  const invalidSale = await fetch(`${baseUrl}/api/v1/inventory/movements`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...receipt,
      movementId: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12",
      type: "sale",
      quantityDelta: -5,
    }),
  });
  assert.equal(invalidSale.status, 409);

  const inventory = await fetch(`${baseUrl}/api/v1/inventory`);
  const inventoryPayload = (await inventory.json()) as {
    data: Array<{ onHand: number }>;
  };
  assert.equal(inventoryPayload.data[0]?.onHand, 4);

  const movements = await fetch(
    `${baseUrl}/api/v1/inventory/movements?productId=${product.data.id}`,
  );
  const movementPayload = (await movements.json()) as {
    data: Array<{ movementId: string; quantityDelta: number }>;
  };
  assert.deepEqual(
    movementPayload.data.map(({ movementId, quantityDelta }) => ({
      movementId,
      quantityDelta,
    })),
    [{ movementId: receipt.movementId, quantityDelta: 4 }],
  );
});

test("reconciles registered RFID tags for one reader and time window", async (context) => {
  const store = new SqliteInventoryStore(":memory:");
  const server = createApiServer(store);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    store.close();
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const productResponse = await fetch(`${baseUrl}/api/v1/products`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: "SKU-RECON", name: "Reconciliation test" }),
  });
  const product = (await productResponse.json()) as {
    data: { id: string };
  };
  const registeredEpc = "E28068940000502C6FE3BCAE";
  await store.bindTag(registeredEpc, product.data.id);
  await store.bindTag("E28068940000502C6FE3BCAD", product.data.id);

  const readEvents = [
    {
      eventId: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      epc: registeredEpc,
      readerId: "stocktake-reader",
      observedAt: "2026-10-26T02:30:00Z",
    },
    {
      eventId: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12",
      epc: registeredEpc,
      readerId: "stocktake-reader",
      observedAt: "2026-10-26T02:31:00Z",
    },
    {
      eventId: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13",
      epc: "E28068940000502C6FE3BCAA",
      readerId: "stocktake-reader",
      observedAt: "2026-10-26T02:32:00Z",
    },
    {
      eventId: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14",
      epc: "E28068940000502C6FE3BCAB",
      readerId: "other-reader",
      observedAt: "2026-10-26T02:33:00Z",
    },
  ];
  for (const event of readEvents) {
    await store.recordScanEvent({
      ...event,
      observedAt: new Date(event.observedAt).toISOString(),
    });
  }

  const reconciliation = await fetch(
    `${baseUrl}/api/v1/inventory/reconciliation?readerId=stocktake-reader&from=2026-10-26T02%3A00%3A00Z&to=2026-10-26T03%3A00%3A00Z`,
  );
  assert.equal(reconciliation.status, 200);
  assert.deepEqual(
    (await reconciliation.json()) as {
      data: {
        readerId: string;
        products: Array<{
          sku: string;
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
      };
    },
    {
      data: {
        readerId: "stocktake-reader",
        from: "2026-10-26T02:00:00.000Z",
        to: "2026-10-26T03:00:00.000Z",
        products: [
          {
            productId: product.data.id,
            sku: "SKU-RECON",
            name: "Reconciliation test",
            registeredTagCount: 2,
            seenTagCount: 1,
            unseenTagCount: 1,
            lastSeenAt: "2026-10-26T02:31:00.000Z",
          },
        ],
        totals: {
          registeredTagCount: 2,
          seenTagCount: 1,
          unseenTagCount: 1,
          unassignedEpcCount: 1,
          unassignedEpcs: ["E28068940000502C6FE3BCAA"],
          unassignedListTruncated: false,
        },
      },
    },
  );

  const invalidRange = await fetch(
    `${baseUrl}/api/v1/inventory/reconciliation?readerId=stocktake-reader&from=2026-10-27T00%3A00%3A00Z&to=2026-10-26T00%3A00%3A00Z`,
  );
  assert.equal(invalidRange.status, 400);
});

test("runs a persisted inventory session from start through close and report", async (context) => {
  const store = new SqliteInventoryStore(":memory:");
  const server = createApiServer(store);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    store.close();
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const productResponse = await fetch(`${baseUrl}/api/v1/products`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: "SKU-SESSION", name: "Session product" }),
  });
  const product = (await productResponse.json()) as {
    data: { id: string };
  };
  const epc = "E28068940000502C6FE3BCAE";
  await store.bindTag(epc, product.data.id);

  const start = await fetch(`${baseUrl}/api/v1/inventory/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ readerId: "session-reader" }),
  });
  assert.equal(start.status, 201);
  const session = (await start.json()) as {
    data: { sessionId: string; readerId: string; startedAt: string; closedAt: null };
  };
  assert.equal(session.data.readerId, "session-reader");
  assert.equal(session.data.closedAt, null);

  const competingStart = await fetch(
    `${baseUrl}/api/v1/inventory/sessions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ readerId: "session-reader" }),
    },
  );
  assert.equal(competingStart.status, 409);

  const scan = await fetch(`${baseUrl}/api/v1/scan-events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventId: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      epc,
      readerId: "session-reader",
      observedAt: session.data.startedAt,
    }),
  });
  assert.equal(scan.status, 202);

  const close = await fetch(
    `${baseUrl}/api/v1/inventory/sessions/${session.data.sessionId}/close`,
    { method: "POST" },
  );
  assert.equal(close.status, 200);
  const closedSession = (await close.json()) as {
    data: { status: string; closedAt: string };
  };
  assert.equal(closedSession.data.status, "closed");

  const repeatedClose = await fetch(
    `${baseUrl}/api/v1/inventory/sessions/${session.data.sessionId}/close`,
    { method: "POST" },
  );
  assert.equal(
    ((await repeatedClose.json()) as { data: { status: string } }).data.status,
    "already_closed",
  );

  const invalidSessionId = await fetch(
    `${baseUrl}/api/v1/inventory/sessions/not-a-uuid`,
  );
  assert.equal(invalidSessionId.status, 400);
  const missingSession = await fetch(
    `${baseUrl}/api/v1/inventory/sessions/f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`,
  );
  assert.equal(missingSession.status, 404);

  const reportResponse = await fetch(
    `${baseUrl}/api/v1/inventory/sessions/${session.data.sessionId}`,
  );
  assert.equal(reportResponse.status, 200);
  const report = (await reportResponse.json()) as {
    data: {
      session: { closedAt: string };
      reconciliation: {
        totals: { registeredTagCount: number; seenTagCount: number; unseenTagCount: number };
      };
    };
  };
  assert.equal(report.data.session.closedAt, closedSession.data.closedAt);
  assert.deepEqual(report.data.reconciliation.totals, {
    registeredTagCount: 1,
    seenTagCount: 1,
    unseenTagCount: 0,
    unassignedEpcCount: 0,
    unassignedEpcs: [],
    unassignedListTruncated: false,
  });

  const sessionsResponse = await fetch(
    `${baseUrl}/api/v1/inventory/sessions?limit=10`,
  );
  assert.equal(
    ((await sessionsResponse.json()) as { data: unknown[] }).data.length,
    1,
  );
});

test("exposes tag unbinding and assignment history", async (context) => {
  const store = new SqliteInventoryStore(":memory:");
  const server = createApiServer(store);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    store.close();
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const productResponse = await fetch(`${baseUrl}/api/v1/products`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: "SKU-TAG-HISTORY", name: "Tag history" }),
  });
  const product = (await productResponse.json()) as {
    data: { id: string };
  };
  const epc = "E28068940000502C6FE3BCAE";
  const bound = await fetch(`${baseUrl}/api/v1/tags`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ epc, productId: product.data.id }),
  });
  assert.equal(bound.status, 201);

  const unbound = await fetch(`${baseUrl}/api/v1/tags/${epc}`, {
    method: "DELETE",
  });
  assert.equal(unbound.status, 200);
  const activeTags = await fetch(`${baseUrl}/api/v1/tags`);
  assert.deepEqual(
    (await activeTags.json()) as { data: unknown[] },
    { data: [] },
  );
  const history = await fetch(
    `${baseUrl}/api/v1/tags/history?epc=${epc}`,
  );
  assert.deepEqual(
    (
      (await history.json()) as {
        data: Array<{ action: string; productId: string; epc: string }>;
      }
    ).data.map(({ action, productId, epc: historyEpc }) => ({
      action,
      productId,
      epc: historyEpc,
    })),
    [
      { action: "unassigned", productId: product.data.id, epc },
      { action: "assigned", productId: product.data.id, epc },
    ],
  );
});

test("validates product and scan-event inputs", async (context) => {
  const store = new SqliteInventoryStore(":memory:");
  const server = createApiServer(store);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    store.close();
  });

  const address = server.address() as AddressInfo;
  const invalidProduct = await fetch(
    `http://127.0.0.1:${address.port}/api/v1/products`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "", name: "Missing SKU" }),
    },
  );
  assert.equal(invalidProduct.status, 400);

  const invalidScan = await fetch(
    `http://127.0.0.1:${address.port}/api/v1/scan-events`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ epc: "invalid" }),
    },
  );
  assert.equal(invalidScan.status, 400);
});

test("updates products through the API without allowing protected fields to change", async (context) => {
  const store = new SqliteInventoryStore(":memory:");
  const server = createApiServer(store, "a".repeat(32));
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    store.close();
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = {
    authorization: `Bearer ${"a".repeat(32)}`,
    "content-type": "application/json",
  };
  const createProduct = async (sku: string, name: string) => {
    const response = await fetch(`${baseUrl}/api/v1/products`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sku, name }),
    });
    assert.equal(response.status, 201);
    return (await response.json()) as {
      data: { id: string; sku: string; name: string; createdAt: string };
    };
  };
  const original = await createProduct("SKU-EDIT-API", "Initial name");
  const second = await createProduct("SKU-EDIT-OTHER", "Other product");

  const unauthorized = await fetch(
    `${baseUrl}/api/v1/products/${original.data.id}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "SKU-UNAUTHORIZED", name: "No access" }),
    },
  );
  assert.equal(unauthorized.status, 401);

  const update = await fetch(`${baseUrl}/api/v1/products/${original.data.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ sku: "SKU-EDITED", name: "Updated name" }),
  });
  assert.equal(update.status, 200);
  assert.deepEqual((await update.json()) as unknown, {
    data: {
      id: original.data.id,
      sku: "SKU-EDITED",
      name: "Updated name",
      createdAt: original.data.createdAt,
    },
  });

  const duplicateSku = await fetch(
    `${baseUrl}/api/v1/products/${original.data.id}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ sku: second.data.sku, name: "Conflicting update" }),
    },
  );
  assert.equal(duplicateSku.status, 409);

  const protectedField = await fetch(
    `${baseUrl}/api/v1/products/${original.data.id}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({
        sku: "SKU-PROTECTED",
        name: "Protected",
        createdAt: "2000-01-01T00:00:00.000Z",
      }),
    },
  );
  assert.equal(protectedField.status, 400);

  const missing = await fetch(
    `${baseUrl}/api/v1/products/00000000-0000-4000-8000-000000000000`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ sku: "SKU-MISSING", name: "Missing product" }),
    },
  );
  assert.equal(missing.status, 404);
});
