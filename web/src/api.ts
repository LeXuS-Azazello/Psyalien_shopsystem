export interface InventoryRow {
  productId: string;
  sku: string;
  name: string;
  price: number;
  onHand: number;
  tagCount: number;
  seenTagCount: number;
  lastSeenAt: string | null;
}

export interface InventoryMovement {
  movementId: string;
  productId: string;
  type: "receipt" | "sale" | "writeoff" | "adjustment";
  quantityDelta: number;
  reference?: string;
  note?: string;
  createdAt: string;
}

export type InventoryMovementType = InventoryMovement["type"];

export interface InventorySession {
  sessionId: string;
  readerId: string;
  startedAt: string;
  closedAt: string | null;
}

export interface Tag {
  epc: string;
  productId: string;
  createdAt: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  price: number;
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

export interface InventorySessionReport {
  session: InventorySession;
  reconciliation: InventoryReconciliation;
}

export interface ScanEvent {
  eventId: string;
  epc: string;
  readerId: string;
  observedAt: string;
  antennaId?: string | number;
  rssi?: number;
}

export interface DashboardData {
  inventory: InventoryRow[];
  movements: InventoryMovement[];
  scans: ScanEvent[];
  sessions: InventorySession[];
  products: Product[];
  tags: Tag[];
  apiOnline: boolean;
}

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestData<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers();
  if (token.trim()) headers.set("Authorization", `Bearer ${token.trim()}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(path, {
    ...init,
    headers,
    cache: "no-store",
  });
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new ApiRequestError("The API returned an unreadable response.", response.status);
  }

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("shopsystem:unauthorized"));
    }
    const message =
      isRecord(body) && typeof body["error"] === "string"
        ? body["error"]
        : `Request failed (${response.status}).`;
    throw new ApiRequestError(message, response.status);
  }
  if (!isRecord(body) || !("data" in body)) {
    throw new ApiRequestError("The API response did not contain data.", response.status);
  }
  return body["data"] as T;
}

async function getApiHealth(): Promise<boolean> {
  try {
    const response = await fetch("/health", { cache: "no-store" });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return isRecord(body) && body["status"] === "ok";
  } catch {
    return false;
  }
}

export async function loadDashboard(token: string): Promise<DashboardData> {
  const [inventory, movements, scans, sessions, products, tags, apiOnline] = await Promise.all([
    requestData<InventoryRow[]>("/api/v1/inventory", token),
    requestData<InventoryMovement[]>("/api/v1/inventory/movements?limit=8", token),
    requestData<ScanEvent[]>("/api/v1/scan-events?limit=8", token),
    requestData<InventorySession[]>("/api/v1/inventory/sessions?limit=8", token),
    requestData<DashboardData["products"]>("/api/v1/products", token),
    requestData<Tag[]>("/api/v1/tags", token),
    getApiHealth(),
  ]);

  if (![inventory, movements, scans, sessions, products, tags].every(Array.isArray)) {
    throw new ApiRequestError("The API returned data in an unexpected format.", 200);
  }
  return { inventory, movements, scans, sessions, products, tags, apiOnline };
}

export async function startInventorySession(
  token: string,
  readerId: string,
): Promise<InventorySession> {
  return requestData<InventorySession>("/api/v1/inventory/sessions", token, {
    method: "POST",
    body: JSON.stringify({ readerId }),
  });
}

export async function closeInventorySession(
  token: string,
  sessionId: string,
): Promise<InventorySession> {
  return requestData<InventorySession>(
    `/api/v1/inventory/sessions/${encodeURIComponent(sessionId)}/close`,
    token,
    { method: "POST" },
  );
}

export async function loadInventorySessionReport(
  token: string,
  sessionId: string,
): Promise<InventorySessionReport> {
  return requestData<InventorySessionReport>(
    `/api/v1/inventory/sessions/${encodeURIComponent(sessionId)}`,
    token,
  );
}

export async function bindTag(
  token: string,
  epc: string,
  productId: string,
): Promise<Tag> {
  return requestData<Tag>("/api/v1/tags", token, {
    method: "POST",
    body: JSON.stringify({ epc, productId }),
  });
}

export async function unbindTag(token: string, epc: string): Promise<Tag> {
  return requestData<Tag>(`/api/v1/tags/${encodeURIComponent(epc)}`, token, {
    method: "DELETE",
  });
}

export async function createProduct(
  token: string,
  sku: string,
  name: string,
  price = 0,
): Promise<Product> {
  return requestData<Product>("/api/v1/products", token, {
    method: "POST",
    body: JSON.stringify({ sku, name, price }),
  });
}

export async function updateProduct(
  token: string,
  id: string,
  sku: string,
  name: string,
  price = 0,
): Promise<Product> {
  return requestData<Product>(`/api/v1/products/${encodeURIComponent(id)}`, token, {
    method: "PUT",
    body: JSON.stringify({ sku, name, price }),
  });
}

export async function createInventoryMovement(
  token: string,
  movement: Omit<InventoryMovement, "createdAt">,
): Promise<InventoryMovement> {
  return requestData<InventoryMovement>("/api/v1/inventory/movements", token, {
    method: "POST",
    body: JSON.stringify(movement),
  });
}
