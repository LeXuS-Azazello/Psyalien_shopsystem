import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type {
  InventoryMovementType,
  InventoryStore,
} from "../storage/inventory-store.ts";
import { StoreError } from "../storage/inventory-store.ts";
import { parseScanEvent } from "../integrations/mqtt/scan-event.ts";

const MAX_BODY_BYTES = 64 * 1024;

class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(serialized);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new ApiError("Request body is too large", 413);
    }
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks);
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new ApiError("Request body must be valid JSON", 400);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(
  body: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
): string {
  const value = body[key];
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > maxLength
  ) {
    throw new ApiError(`${label} must be a non-empty string of at most ${maxLength} characters`, 400);
  }
  return value.trim();
}

function optionalText(
  body: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
): string | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > maxLength
  ) {
    throw new ApiError(`${label} must be a non-empty string of at most ${maxLength} characters`, 400);
  }
  return value.trim();
}

function parseMovementType(value: unknown): InventoryMovementType {
  if (
    value !== "receipt" &&
    value !== "sale" &&
    value !== "writeoff" &&
    value !== "adjustment"
  ) {
    throw new ApiError(
      "type must be receipt, sale, writeoff, or adjustment",
      400,
    );
  }
  return value;
}

function requiredTimestamp(value: string | null, name: string): string {
  if (
    value === null ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new ApiError(`${name} must be an ISO 8601 timestamp with a timezone`, 400);
  }
  return new Date(value).toISOString();
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: InventoryStore,
  apiToken?: string,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (
    apiToken &&
    !isAuthorized(request.headers.authorization, apiToken)
  ) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }

  if (method === "GET" && url.pathname === "/api/v1/products") {
    sendJson(response, 200, { data: await store.listProducts() });
    return;
  }

  if (method === "GET" && url.pathname === "/api/v1/inventory") {
    sendJson(response, 200, { data: await store.listInventory() });
    return;
  }

  if (
    method === "GET" &&
    url.pathname === "/api/v1/inventory/reconciliation"
  ) {
    const readerId = url.searchParams.get("readerId")?.trim();
    if (!readerId || readerId.length > 140) {
      throw new ApiError("readerId must be a non-empty string of at most 140 characters", 400);
    }
    const from = requiredTimestamp(url.searchParams.get("from"), "from");
    const to = requiredTimestamp(url.searchParams.get("to"), "to");
    const fromTime = Date.parse(from);
    const toTime = Date.parse(to);
    if (fromTime >= toTime) {
      throw new ApiError("from must be earlier than to", 400);
    }
    if (toTime - fromTime > 31 * 24 * 60 * 60 * 1000) {
      throw new ApiError("reconciliation range must not exceed 31 days", 400);
    }
    sendJson(response, 200, {
      data: await store.reconcileInventory(readerId, from, to),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/v1/inventory/sessions") {
    const body = await readJson(request);
    if (!isRecord(body)) {
      throw new ApiError("Request body must be a JSON object", 400);
    }
    const session = await store.createInventorySession(
      requiredText(body, "readerId", "readerId", 140),
    );
    sendJson(response, 201, { data: session });
    return;
  }

  if (method === "GET" && url.pathname === "/api/v1/inventory/sessions") {
    const limitValue = url.searchParams.get("limit") ?? "100";
    const limit = Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new ApiError("limit must be an integer between 1 and 500", 400);
    }
    sendJson(response, 200, {
      data: await store.listInventorySessions(limit),
    });
    return;
  }

  const inventorySessionMatch =
    /^\/api\/v1\/inventory\/sessions\/([^/]+)(\/close)?$/i.exec(
      url.pathname,
    );
  if (inventorySessionMatch) {
    const sessionId = inventorySessionMatch[1] ?? "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        sessionId,
      )
    ) {
      throw new ApiError("sessionId must be a UUID", 400);
    }
    if (method === "POST" && inventorySessionMatch[2] === "/close") {
      const result = await store.closeInventorySession(sessionId);
      sendJson(response, 200, {
        data: { ...result.session, status: result.status },
      });
      return;
    }
    if (method === "GET" && inventorySessionMatch[2] === undefined) {
      sendJson(response, 200, {
        data: await store.getInventorySessionReport(sessionId),
      });
      return;
    }
  }

  if (method === "GET" && url.pathname === "/api/v1/inventory/movements") {
    const limitValue = url.searchParams.get("limit") ?? "100";
    const limit = Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new ApiError("limit must be an integer between 1 and 500", 400);
    }
    const productId = url.searchParams.get("productId")?.trim();
    if (productId !== undefined && (productId.length === 0 || productId.length > 36)) {
      throw new ApiError("productId must be a non-empty ID of at most 36 characters", 400);
    }
    sendJson(response, 200, {
      data: await store.listInventoryMovements(limit, productId),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/v1/inventory/movements") {
    const body = await readJson(request);
    if (!isRecord(body)) {
      throw new ApiError("Request body must be a JSON object", 400);
    }
    const movementId = requiredText(body, "movementId", "movementId", 36);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        movementId,
      )
    ) {
      throw new ApiError("movementId must be a UUID", 400);
    }
    const type = parseMovementType(body["type"]);
    const quantityDelta = body["quantityDelta"];
    if (
      typeof quantityDelta !== "number" ||
      !Number.isSafeInteger(quantityDelta) ||
      quantityDelta === 0 ||
      Math.abs(quantityDelta) > 1_000_000
    ) {
      throw new ApiError(
        "quantityDelta must be a non-zero integer between -1000000 and 1000000",
        400,
      );
    }
    if (
      (type === "receipt" && quantityDelta < 0) ||
      ((type === "sale" || type === "writeoff") && quantityDelta > 0)
    ) {
      throw new ApiError(
        "receipt requires a positive quantityDelta; sale and writeoff require a negative quantityDelta",
        400,
      );
    }
    const reference = optionalText(body, "reference", "reference", 140);
    const note = optionalText(body, "note", "note", 500);
    const movement = await store.recordInventoryMovement({
      movementId,
      productId: requiredText(body, "productId", "productId", 36),
      type,
      quantityDelta,
      ...(reference ? { reference } : {}),
      ...(note ? { note } : {}),
    });
    sendJson(response, movement.status === "accepted" ? 201 : 200, {
      data: { ...movement.movement, status: movement.status },
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/v1/products") {
    const body = await readJson(request);
    if (!isRecord(body)) {
      throw new ApiError("Request body must be a JSON object", 400);
    }
    const product = await store.createProduct(
      requiredText(body, "sku", "sku", 100),
      requiredText(body, "name", "name", 200),
    );
    sendJson(response, 201, { data: product });
    return;
  }

  const productMatch = /^\/api\/v1\/products\/([^/]+)$/i.exec(url.pathname);
  if (productMatch && method === "PUT") {
    const productId = productMatch[1] ?? "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        productId,
      )
    ) {
      throw new ApiError("productId must be a UUID", 400);
    }
    const body = await readJson(request);
    if (!isRecord(body)) {
      throw new ApiError("Request body must be a JSON object", 400);
    }
    if (Object.keys(body).some((key) => key !== "sku" && key !== "name")) {
      throw new ApiError("Only sku and name can be updated", 400);
    }
    const product = await store.updateProduct(
      productId,
      requiredText(body, "sku", "sku", 100),
      requiredText(body, "name", "name", 200),
    );
    sendJson(response, 200, { data: product });
    return;
  }

  if (method === "GET" && url.pathname === "/api/v1/tags") {
    sendJson(response, 200, { data: await store.listTags() });
    return;
  }

  if (method === "GET" && url.pathname === "/api/v1/tags/history") {
    const limitValue = url.searchParams.get("limit") ?? "100";
    const limit = Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new ApiError("limit must be an integer between 1 and 500", 400);
    }
    const epcValue = url.searchParams.get("epc");
    const epc = epcValue?.trim().toUpperCase();
    if (
      epc &&
      (epc.length < 4 ||
        epc.length > 128 ||
        epc.length % 2 !== 0 ||
        !/^[0-9A-F]+$/.test(epc))
    ) {
      throw new ApiError("epc must be a valid hexadecimal EPC", 400);
    }
    sendJson(response, 200, {
      data: await store.listTagHistory(limit, epc),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/v1/tags") {
    const body = await readJson(request);
    if (!isRecord(body)) {
      throw new ApiError("Request body must be a JSON object", 400);
    }
    const epc = requiredText(body, "epc", "epc", 128).toUpperCase();
    if (epc.length < 4 || epc.length % 2 !== 0 || !/^[0-9A-F]+$/.test(epc)) {
      throw new ApiError("epc must contain 2 to 64 bytes encoded as hexadecimal", 400);
    }
    const productId = requiredText(body, "productId", "productId", 36);
    sendJson(response, 201, { data: await store.bindTag(epc, productId) });
    return;
  }

  const tagEpcMatch = /^\/api\/v1\/tags\/([0-9a-f]+)$/i.exec(url.pathname);
  if (method === "DELETE" && tagEpcMatch) {
    const epc = tagEpcMatch[1]?.toUpperCase();
    if (!epc || epc.length < 4 || epc.length > 128 || epc.length % 2 !== 0) {
      throw new ApiError("epc must contain 2 to 64 bytes encoded as hexadecimal", 400);
    }
    sendJson(response, 200, { data: await store.unbindTag(epc) });
    return;
  }

  if (method === "GET" && url.pathname === "/api/v1/scan-events") {
    const limitValue = url.searchParams.get("limit") ?? "100";
    const limit = Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new ApiError("limit must be an integer between 1 and 500", 400);
    }
    const epcValue = url.searchParams.get("epc");
    const epc = epcValue?.trim().toUpperCase();
    if (epc && (epc.length < 4 || epc.length > 128 || epc.length % 2 || !/^[0-9A-F]+$/.test(epc))) {
      throw new ApiError("epc must be a valid hexadecimal EPC", 400);
    }
    sendJson(response, 200, {
      data: await store.listScanEvents(limit, epc),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/v1/scan-events") {
    const body = await readJson(request);
    let event;
    try {
      event = parseScanEvent(Buffer.from(JSON.stringify(body)));
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? error.message : "Invalid scan event",
        400,
      );
    }
    const result = await store.recordScanEvent(event);
    sendJson(response, result.status === "accepted" ? 202 : 200, {
      data: { ...event, status: result.status },
    });
    return;
  }

  throw new ApiError("Route not found", 404);
}

function isAuthorized(header: string | undefined, apiToken: string): boolean {
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(apiToken);
  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}

export function createApiServer(
  store: InventoryStore,
  apiToken?: string,
): Server {
  return createServer((request, response) => {
    void handleRequest(request, response, store, apiToken).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof StoreError || error instanceof ApiError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      console.error("HTTP request failed:", error);
      sendJson(response, 500, { error: "Internal server error" });
    });
  });
}
