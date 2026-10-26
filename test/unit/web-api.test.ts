import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApiRequestError,
  bindTag,
  closeInventorySession,
  createInventoryMovement,
  createProduct,
  loadDashboard,
  loadInventorySessionReport,
  startInventorySession,
  unbindTag,
  updateProduct,
} from "../../web/src/api.ts";

test("dashboard requests same-origin API routes with an in-memory bearer token", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, authorization: headers.get("Authorization") });

    if (url === "/health") {
      return Response.json({ status: "ok" });
    }
    return Response.json({ data: [] });
  };

  try {
    const dashboard = await loadDashboard("session-token");
    assert.deepEqual(dashboard, {
      inventory: [],
      movements: [],
      scans: [],
      sessions: [],
      products: [],
      tags: [],
      apiOnline: true,
    });
    assert.equal(requests.length, 7);
    assert.ok(requests.every(({ url }) => url.startsWith("/") && !url.startsWith("//")));
    assert.ok(
      requests
        .filter(({ url }) => url.startsWith("/api/"))
        .every(({ authorization }) => authorization === "Bearer session-token"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tag assignment requests use the authenticated tag API", async () => {
  const requests: Array<{
    url: string;
    method: string;
    hasAuthorization: boolean;
    body: string | null;
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      hasAuthorization: headers.has("Authorization"),
      body: typeof init?.body === "string" ? init.body : null,
    });
    return Response.json({
      data: {
        epc: "E28068940000402C6FE3C0AE",
        productId: "product-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
  };

  try {
    const assigned = await bindTag(
      "session-token",
      "E28068940000402C6FE3C0AE",
      "product-1",
    );
    const removed = await unbindTag("session-token", assigned.epc);
    assert.equal(removed.productId, "product-1");
    assert.deepEqual(requests, [
      {
        url: "/api/v1/tags",
        method: "POST",
        hasAuthorization: true,
        body: JSON.stringify({
          epc: "E28068940000402C6FE3C0AE",
          productId: "product-1",
        }),
      },
      {
        url: "/api/v1/tags/E28068940000402C6FE3C0AE",
        method: "DELETE",
        hasAuthorization: true,
        body: null,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("inventory session requests use the authenticated session API", async () => {
  const requests: Array<{
    url: string;
    method: string;
    hasAuthorization: boolean;
    body: string | null;
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("Authorization"),
      body: typeof init?.body === "string" ? init.body : null,
    });
    if (url.endsWith("/close")) {
      return Response.json({ data: { sessionId: "session-1", readerId: "reader-1", startedAt: "2026-01-01T00:00:00Z", closedAt: "2026-01-01T01:00:00Z" } });
    }
    if (url.endsWith("/session-1")) {
      return Response.json({ data: { session: { sessionId: "session-1" }, reconciliation: { totals: {} } } });
    }
    return Response.json({ data: { sessionId: "session-1", readerId: "reader-1", startedAt: "2026-01-01T00:00:00Z", closedAt: null } });
  };

  try {
    const started = await startInventorySession("session-token", "reader-1");
    const closed = await closeInventorySession("session-token", started.sessionId);
    await loadInventorySessionReport("session-token", started.sessionId);

    assert.equal(closed.closedAt, "2026-01-01T01:00:00Z");
    assert.deepEqual(requests, [
      {
        url: "/api/v1/inventory/sessions",
        method: "POST",
        authorization: "Bearer session-token",
        body: JSON.stringify({ readerId: "reader-1" }),
      },
      {
        url: "/api/v1/inventory/sessions/session-1/close",
        method: "POST",
        authorization: "Bearer session-token",
        body: null,
      },
      {
        url: "/api/v1/inventory/sessions/session-1",
        method: "GET",
        authorization: "Bearer session-token",
        body: null,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("product create and edit requests stay same-origin and use the in-memory token", async () => {
  const requests: Array<{
    url: string;
    method: string;
    authorization: string | null;
    body: string | null;
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      hasAuthorization: new Headers(init?.headers).has("Authorization"),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const requestBody = typeof init?.body === "string" ? JSON.parse(init.body) as { sku: string; name: string } : { sku: "", name: "" };
    return Response.json({
      data: {
        id: "product-1",
        sku: requestBody.sku,
        name: requestBody.name,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
  };

  try {
    const created = await createProduct("session-token", "SKU-001", "Utility jacket");
    const updated = await updateProduct("session-token", created.id, "SKU-002", "Field jacket");
    assert.equal(updated.name, "Field jacket");
    assert.deepEqual(requests, [
      {
        url: "/api/v1/products",
        method: "POST",
        hasAuthorization: true,
        body: JSON.stringify({ sku: "SKU-001", name: "Utility jacket", price: 0 }),
      },
      {
        url: "/api/v1/products/product-1",
        method: "PUT",
        hasAuthorization: true,
        body: JSON.stringify({ sku: "SKU-002", name: "Field jacket", price: 0 }),
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("inventory movement requests send an idempotent ledger entry to the authenticated API", async () => {
  const originalFetch = globalThis.fetch;
  let request: {
    url: string;
    method: string;
    hasAuthorization: boolean;
    body: string | null;
  } | null = null;
  globalThis.fetch = async (input, init) => {
    request = {
      url: String(input),
      method: init?.method ?? "GET",
      hasAuthorization: new Headers(init?.headers).has("Authorization"),
      body: typeof init?.body === "string" ? init.body : null,
    };
    return Response.json({
      data: {
        movementId: "movement-1",
        productId: "product-1",
        type: "receipt",
        quantityDelta: 4,
        reference: "delivery-42",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
  };

  try {
    const movement = await createInventoryMovement("session-token", {
      movementId: "movement-1",
      productId: "product-1",
      type: "receipt",
      quantityDelta: 4,
      reference: "delivery-42",
    });
    assert.equal(movement.quantityDelta, 4);
    assert.deepEqual(request, {
      url: "/api/v1/inventory/movements",
      method: "POST",
      hasAuthorization: true,
      body: JSON.stringify({
        movementId: "movement-1",
        productId: "product-1",
        type: "receipt",
        quantityDelta: 4,
        reference: "delivery-42",
      }),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dashboard API errors retain the backend status and message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await assert.rejects(
      loadDashboard(""),
      (error: unknown) =>
        error instanceof ApiRequestError &&
        error.status === 401 &&
        error.message === "Unauthorized",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unauthorized API requests trigger a generic in-memory access-reset event", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events: Event[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent(event: Event) {
        events.push(event);
        return true;
      },
    } as unknown as Window,
  });
  globalThis.fetch = async () =>
    Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await assert.rejects(loadDashboard("do-not-expose-this-token"));
    assert.ok(events.length > 0);
    assert.ok(events.every((event) => event.type === "shopsystem:unauthorized"));
    assert.ok(events.every((event) => !("detail" in event)));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: Window }).window;
    }
  }
});
