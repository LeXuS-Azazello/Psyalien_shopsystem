import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ProductCatalogPanel, TagAssignmentsPanel, QuickTagRegister } from "./catalog-panels.tsx";
import { GuideScreen, LoginScreen, ReadersScreen, SettingsScreen } from "./support-screens.tsx";
import {
  ApiRequestError,
  closeInventorySession,
  createInventoryMovement,
  loadDashboard,
  loadInventorySessionReport,
  startInventorySession,
  type DashboardData,
  type InventorySession,
  type InventorySessionReport,
  type InventoryMovement,
  type InventoryMovementType,
  type InventoryRow,
  type ScanEvent,
} from "../api.ts";

export type LoadState = "loading" | "ready" | "error";

const numberFormat = new Intl.NumberFormat("en");
const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const TOKEN_KEY = "psyalien_api_token";
const TOKEN_TS_KEY = "psyalien_api_token_ts";
const MAX_TOKEN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function loadSavedToken(): { token: string; ts: number } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const ts = localStorage.getItem(TOKEN_TS_KEY);
    if (!token || !ts) return null;
    return { token, ts: Number(ts) };
  } catch {
    return null;
  }
}

function saveToken(token: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_TS_KEY, String(Date.now()));
  } catch {
    // localStorage unavailable; token stays in memory only.
  }
}

function clearTokenStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_TS_KEY);
  } catch {
    // ignore
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "No recorded sighting";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : dateFormat.format(date);
}

function shortEpc(epc: string): string {
  return epc.length > 14 ? `${epc.slice(0, 8)}…${epc.slice(-4)}` : epc;
}

function movementLabel(type: InventoryMovement["type"]): string {
  switch (type) {
    case "receipt":
      return "Received";
    case "sale":
      return "Sale";
    case "writeoff":
      return "Write-off";
    case "adjustment":
      return "Adjustment";
  }
}

function PageMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function MetricIcon({ kind }: { kind: "stock" | "catalog" | "rfid" }) {
  if (kind === "stock") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m3.5 8 8.5-4.5L20.5 8 12 12.5 3.5 8Z" />
        <path d="M3.5 8v8L12 20.5l8.5-4.5V8M12 12.5v8" />
      </svg>
    );
  }
  if (kind === "catalog") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4.5h14v15H5zM8.5 8h7M8.5 12h7M8.5 16h4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9a11 11 0 0 1 16 0M7 12a7 7 0 0 1 10 0m-7 3a3 3 0 0 1 4 0m-2 4h.01" />
    </svg>
  );
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "—";
}

function InventoryTable({ rows, limit = 8 }: { rows: InventoryRow[]; limit?: number }) {
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-mark" aria-hidden="true">＋</span>
        <strong>No inventory records yet</strong>
        <p>Products appear here after they have been added to the catalog.</p>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="inventory-table">
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">On hand</th>
            <th scope="col">RFID tags</th>
            <th scope="col">Last recorded sighting</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((row, index) => (
            <tr key={row.productId}>
              <td>
                <div className="product-cell">
                  <span className={`product-avatar avatar-${index % 4}`} aria-hidden="true">
                    {initials(row.name)}
                  </span>
                  <span className="product-copy">
                    <strong>{row.name}</strong>
                    <small>{row.sku}</small>
                  </span>
                </div>
              </td>
              <td>
                <span className={`stock-value${row.onHand === 0 ? " stock-zero" : ""}`}>
                  {numberFormat.format(row.onHand)}
                  <small>units</small>
                </span>
              </td>
              <td>
                <span className="tag-count">
                  {numberFormat.format(row.tagCount)}
                  <small>{numberFormat.format(row.seenTagCount)} seen before</small>
                </span>
              </td>
              <td className="sighting-cell">{formatDate(row.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && (
        <div className="table-footnote">Showing {numberFormat.format(limit)} of {numberFormat.format(rows.length)} products</div>
      )}
    </div>
  );
}

function MovementList({
  movements,
  products,
}: {
  movements: InventoryMovement[];
  products: DashboardData["products"];
}) {
  const names = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products],
  );

  if (movements.length === 0) {
    return <div className="compact-empty">No stock movements recorded yet.</div>;
  }

  return (
    <ul className="activity-list">
      {movements.slice(0, 5).map((movement) => (
        <li key={movement.movementId}>
          <span className={`movement-icon movement-${movement.type}`} aria-hidden="true">
            {movement.quantityDelta > 0 ? "+" : "−"}
          </span>
          <span className="activity-copy">
            <strong>{movementLabel(movement.type)} · {names.get(movement.productId) ?? "Product"}</strong>
            <small>{movement.reference || formatDate(movement.createdAt)}</small>
          </span>
          <span className={`movement-quantity${movement.quantityDelta > 0 ? " quantity-up" : ""}`}>
            {movement.quantityDelta > 0 ? "+" : ""}
            {numberFormat.format(movement.quantityDelta)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ScanList({ scans }: { scans: ScanEvent[] }) {
  if (scans.length === 0) {
    return <div className="compact-empty">No scan events have been received yet.</div>;
  }

  return (
    <ul className="activity-list scan-list">
      {scans.slice(0, 5).map((scan) => (
        <li key={scan.eventId}>
          <span className="scan-dot" aria-hidden="true" />
          <span className="activity-copy">
            <strong className="mono">{shortEpc(scan.epc)}</strong>
            <small>{scan.readerId}</small>
          </span>
          <span className="activity-time">{formatDate(scan.observedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function AccessPanel({
  tokenInput,
  onChange,
  onSubmit,
  onClose,
  required,
  errorMessage,
}: {
  tokenInput: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  required: boolean;
  errorMessage: string | null;
}) {
  return (
    <section className={`access-panel${required ? " access-required" : ""}`} aria-label="API access">
      <div className="access-copy">
        <span className="access-lock" aria-hidden="true">⌑</span>
        <div>
          <strong>{required ? "Authentication required" : "API access"}</strong>
          <p>
            {required
              ? "This API is protected. Enter its token to load the overview."
              : "Enter a token only if this API requires one. It stays in memory for this session."}
          </p>
        </div>
      </div>
      <form className="token-form" onSubmit={onSubmit}>
        <label className="visually-hidden" htmlFor="api-token">API bearer token</label>
        <input
          id="api-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Bearer token"
          value={tokenInput}
          onChange={(event) => onChange(event.target.value)}
        />
        <button className="button button-bright" type="submit">
          {required ? "Connect" : "Apply"}
        </button>
        {!required && <button className="button button-quiet" type="button" onClick={onClose}>Close</button>}
        {errorMessage && <span className="token-error" role="alert">{errorMessage}</span>}
      </form>
    </section>
  );
}

function InventorySessionsPanel({
  sessions,
  token,
  onRefresh,
}: {
  sessions: InventorySession[];
  token: string;
  onRefresh: () => Promise<void>;
}) {
  const [readerId, setReaderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [report, setReport] = useState<InventorySessionReport | null>(null);

  async function showReport(sessionId: string) {
    setBusy(true);
    setActionError(null);
    try {
      setReport(await loadInventorySessionReport(token, sessionId));
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not load the session report.");
    } finally {
      setBusy(false);
    }
  }

  async function startSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextReaderId = readerId.trim();
    if (!nextReaderId) return;

    setBusy(true);
    setActionError(null);
    try {
      const session = await startInventorySession(token, nextReaderId);
      setReaderId("");
      await onRefresh();
      setReport(await loadInventorySessionReport(token, session.sessionId));
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not start the inventory session.");
    } finally {
      setBusy(false);
    }
  }

  async function finishSession(sessionId: string) {
    if (!window.confirm("Close this session and freeze its inventory report?")) return;

    setBusy(true);
    setActionError(null);
    try {
      await closeInventorySession(token, sessionId);
      await onRefresh();
      setReport(await loadInventorySessionReport(token, sessionId));
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not close the inventory session.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel inventory-sessions-panel">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">RFID STOCKTAKE <span>02</span></div>
          <h2>Inventory sessions</h2>
          <p>Compare assigned tags with reads from one selected reader.</p>
        </div>
        <div className="panel-count"><span className="count-square" />{sessions.length} RECENT</div>
      </div>

      <form className="session-start-form" onSubmit={(event) => void startSession(event)}>
        <label htmlFor="session-reader">Reader ID</label>
        <input
          id="session-reader"
          name="readerId"
          autoComplete="off"
          maxLength={140}
          placeholder="e.g. stockroom-reader-01"
          required
          value={readerId}
          onChange={(event) => setReaderId(event.target.value)}
        />
        <button className="button button-bright" type="submit" disabled={busy || !readerId.trim()}>
          Start stocktake
        </button>
      </form>

      {actionError && <div className="session-error" role="alert">{actionError}</div>}

      {sessions.length === 0 ? (
        <div className="compact-empty session-empty">No inventory sessions have been started.</div>
      ) : (
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.sessionId}>
              <span className={`session-status${session.closedAt ? "" : " session-open"}`}>
                {session.closedAt ? "Closed" : "Open"}
              </span>
              <span className="activity-copy">
                <strong>{session.readerId}</strong>
                <small>Started {formatDate(session.startedAt)}{session.closedAt ? ` · closed ${formatDate(session.closedAt)}` : ""}</small>
              </span>
              <button
                className="button button-quiet session-action"
                type="button"
                onClick={() => void showReport(session.sessionId)}
                disabled={busy}
              >
                View report
              </button>
              {!session.closedAt && (
                <button
                  className="button button-quiet session-action"
                  type="button"
                  onClick={() => void finishSession(session.sessionId)}
                  disabled={busy}
                >
                  Close
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {report && (
        <div className="session-report" aria-live="polite">
          <div className="session-report-heading">
            <div>
              <div className="section-kicker">SESSION REPORT</div>
              <h3>{report.session.readerId}</h3>
              <p>
                {formatDate(report.reconciliation.from)} – {formatDate(report.reconciliation.to)}
                {report.session.closedAt ? " · frozen" : " · live"}
              </p>
            </div>
            <button
              className="button button-quiet session-action"
              type="button"
              onClick={() => setReport(null)}
            >
              Hide report
            </button>
          </div>
          <div className="session-totals">
            <span><strong>{numberFormat.format(report.reconciliation.totals.seenTagCount)}</strong> seen</span>
            <span><strong>{numberFormat.format(report.reconciliation.totals.unseenTagCount)}</strong> not seen</span>
            <span><strong>{numberFormat.format(report.reconciliation.totals.unassignedEpcCount)}</strong> unassigned EPCs</span>
          </div>
          <div className="table-scroll">
            <table className="session-report-table">
              <thead>
                <tr><th>Product</th><th>Assigned</th><th>Seen</th><th>Not seen</th></tr>
              </thead>
              <tbody>
                {report.reconciliation.products.map((product) => (
                  <tr key={product.productId}>
                    <td><strong>{product.name}</strong><small>{product.sku}</small></td>
                    <td>{numberFormat.format(product.registeredTagCount)}</td>
                    <td>{numberFormat.format(product.seenTagCount)}</td>
                    <td>{numberFormat.format(product.unseenTagCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="data-note">
            This report compares RFID reads with tag assignments. A tag not seen is not proof that an item is absent.
          </p>
        </div>
      )}
    </section>
  );
}

type PageId = "overview" | "products" | "inventory" | "readers" | "settings" | "guide";

const pageLabels: Record<PageId, string> = {
  overview: "Overview",
  products: "Products",
  inventory: "Inventory",
  readers: "Readers & integrations",
  settings: "Settings",
  guide: "User guide / FAQ",
};

function pageFromHash(hash: string): PageId {
  const page = hash.replace(/^#/, "").split("/")[0] as PageId;
  return page in pageLabels ? page : "overview";
}

function hashForPage(page: PageId): string {
  return `#/${page}`;
}

function pageSubtitle(page: PageId): string {
  switch (page) {
    case "overview":
      return "Your inventory, tags, and recent activity in one place.";
    case "products":
      return "Search and maintain the catalog used by stock and RFID assignments.";
    case "inventory":
      return "Record explicit stock movements and review the current ledger balance.";
    case "readers":
      return "Verified reader workflow and integration limits.";
    case "settings":
      return "Connection and access guidance for this local system.";
    case "guide":
      return "Quick answers for common shop-floor workflows.";
  }
}

function PageHeading({ page, subtitle }: { page: PageId; subtitle: string }) {
  return (
    <section className="page-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-line" />SHOP FLOOR / WORKSPACE</div>
        <h1>{pageLabels[page]}<span className="heading-period">.</span></h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      <div className="heading-meta">
        <div className="meta-label">DATA SOURCE</div>
        <div className="meta-value"><span className="source-dot" />Local inventory engine</div>
      </div>
    </section>
  );
}

function InventoryMovementPanel({
  inventory,
  movements,
  products,
  token,
  onRefresh,
}: {
  inventory: InventoryRow[];
  movements: InventoryMovement[];
  products: DashboardData["products"];
  token: string;
  onRefresh: () => Promise<void>;
}) {
  const [productId, setProductId] = useState("");
  const [type, setType] = useState<InventoryMovementType>("receipt");
  const [quantityDelta, setQuantityDelta] = useState("");
  const [reference, setReference] = useState("");
  const [movementId, setMovementId] = useState(() => globalThis.crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = Number(quantityDelta);
    if (!productId || !Number.isSafeInteger(quantity) || quantity === 0 || Math.abs(quantity) > 1_000_000) {
      setActionError("Enter a non-zero whole-number quantity delta (maximum 1,000,000).");
      return;
    }
    if ((type === "receipt" && quantity < 0) || ((type === "sale" || type === "writeoff") && quantity > 0)) {
      setActionError(type === "receipt"
        ? "Receipts need a positive quantity delta."
        : "Sales and write-offs need a negative quantity delta.");
      return;
    }

    setBusy(true);
    setActionError(null);
    setSuccess(null);
    try {
      await createInventoryMovement(token, {
        movementId,
        productId,
        type,
        quantityDelta: quantity,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      const product = products.find((item) => item.id === productId);
      setQuantityDelta("");
      setReference("");
      setMovementId(globalThis.crypto.randomUUID());
      setSuccess(`${movementLabel(type)} ${quantity > 0 ? "+" : ""}${quantity} unit${Math.abs(quantity) === 1 ? "" : "s"}${product ? ` for ${product.name}` : ""}.`);
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not record the stock movement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel movement-entry-panel">
        <div className="panel-heading">
          <div>
            <div className="section-kicker">MANUAL STOCK CONTROL <span>01</span></div>
            <h2>Record a movement</h2>
            <p>Every change is recorded in the append-only stock ledger.</p>
          </div>
        </div>
        <form className="movement-form" onSubmit={(event) => void submitMovement(event)}>
          <label>
            <span>Product</span>
            <select required value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">Choose a product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Movement type</span>
            <select value={type} onChange={(event) => setType(event.target.value as InventoryMovementType)}>
              <option value="receipt">Receipt</option>
              <option value="sale">Sale</option>
              <option value="writeoff">Write-off</option>
              <option value="adjustment">Adjustment</option>
            </select>
          </label>
          <label>
            <span>Quantity delta</span>
            <input
              type="number"
              step="1"
              min={type === "receipt" ? 1 : type === "adjustment" ? -1_000_000 : -1_000_000}
              max={type === "sale" || type === "writeoff" ? -1 : 1_000_000}
              required
              placeholder={type === "receipt" ? "e.g. 12" : type === "adjustment" ? "e.g. -2 or 5" : "e.g. -1"}
              value={quantityDelta}
              onChange={(event) => setQuantityDelta(event.target.value)}
            />
          </label>
          <label>
            <span>Reference <small>optional</small></span>
            <input
              maxLength={140}
              placeholder="e.g. delivery-042"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
          <label className="movement-id-field">
            <span>Movement ID <small>retry-safe</small></span>
            <input value={movementId} readOnly />
          </label>
          <button className="button button-bright" type="submit" disabled={busy || products.length === 0}>
            {busy ? "Recording…" : "Record movement"}
          </button>
          <p className="movement-hint">
            Receipt must be positive; sale and write-off must be negative. Adjustment accepts either sign.
          </p>
        </form>
        {actionError && <div className="session-error" role="alert">{actionError}</div>}
        {success && <div className="movement-success" role="status">{success} Stock counts refreshed.</div>}
        {products.length === 0 && <p className="data-note">Add a product in Products before recording a movement.</p>}
      </section>

      <section className="panel inventory-screen-panel">
        <div className="panel-heading">
          <div>
            <div className="section-kicker">CURRENT BALANCE <span>02</span></div>
            <h2>Stock by product</h2>
            <p>On-hand values are calculated from the movement ledger, never from RFID scans.</p>
          </div>
          <div className="panel-count"><span className="count-square" />{inventory.length} PRODUCTS</div>
        </div>
        <InventoryTable rows={inventory} limit={inventory.length} />
        <p className="data-note">RFID scans are observations only. They do not increase, decrease, or reconcile stock.</p>
      </section>

      <section className="panel inventory-screen-panel">
        <div className="panel-heading">
          <div>
            <div className="section-kicker">APPEND-ONLY HISTORY <span>03</span></div>
            <h2>Recent movements</h2>
            <p>Latest ledger entries. A new entry has a unique movement ID for safe retries.</p>
          </div>
          <div className="panel-count"><span className="count-square" />{movements.length} LOADED</div>
        </div>
        <MovementList movements={movements} products={products} />
      </section>
    </>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState<PageId>(
    typeof window !== "undefined" ? pageFromHash(window.location.hash) : "overview",
  );
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [activeToken, setActiveToken] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const refreshGeneration = useRef(0);

  useEffect(() => {
    const onHashChange = () => {
      setActivePage(pageFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(page: PageId) {
    setActivePage(page);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", hashForPage(page));
    }
  }

  useEffect(() => {
    const handleUnauthorized = () => {
      refreshGeneration.current += 1;
      setDashboard(null);
      setNeedsToken(true);
      setTokenInput("");
      setError("Access was rejected. Enter the shared API token again.");
      setLoadState("error");
      setActiveToken((token) => token ? "" : token);
      clearTokenStorage();
    };
    window.addEventListener("shopsystem:unauthorized", handleUnauthorized);

    // Auto-login from saved token (valid for 30 days).
    const saved = loadSavedToken();
    if (saved && Date.now() - saved.ts < MAX_TOKEN_AGE_MS) {
      setActiveToken(saved.token);
      setTokenInput("");
    } else {
      clearTokenStorage();
      setNeedsToken(true);
    }

    return () => window.removeEventListener("shopsystem:unauthorized", handleUnauthorized);
  }, []);

  const refresh = useCallback(async (token = activeToken) => {
    const generation = ++refreshGeneration.current;
    setLoadState("loading");
    setError(null);
    try {
      const data = await loadDashboard(token);
      if (generation !== refreshGeneration.current) return;
      setDashboard(data);
      setNeedsToken(false);
      setLoadState("ready");
      setLastUpdated(new Date());
    } catch (reason) {
      if (generation !== refreshGeneration.current) return;
      const message = reason instanceof Error ? reason.message : "Could not load inventory data.";
      setError(message);
      if (reason instanceof ApiRequestError && reason.status === 401) {
        setDashboard(null);
        setNeedsToken(true);
        setActiveToken("");
      }
      setLoadState("error");
    }
  }, [activeToken]);

  useEffect(() => {
    void refresh(activeToken);
  }, [activeToken, refresh]);

  const totals = useMemo(() => {
    const inventory = dashboard?.inventory ?? [];
    return {
      onHand: inventory.reduce((sum, row) => sum + row.onHand, 0),
      tags: inventory.reduce((sum, row) => sum + row.tagCount, 0),
      products: dashboard?.products.length ?? 0,
    };
  }, [dashboard]);

  function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextToken = tokenInput.trim();
    refreshGeneration.current += 1;
    setDashboard(null);
    setError(null);
    setLoadState("loading");
    setNeedsToken(true);
    setActiveToken(nextToken);
    setTokenInput("");
    saveToken(nextToken);
  }

  function signOut() {
    refreshGeneration.current += 1;
    setDashboard(null);
    setTokenInput("");
    setError(null);
    setNeedsToken(true);
    setLoadState("loading");
    navigate("overview");
    setActiveToken("");
    clearTokenStorage();
    void refresh("");
  }

  if (needsToken) {
    return (
      <LoginScreen
        tokenInput={tokenInput}
        onChange={setTokenInput}
        onSubmit={submitToken}
        errorMessage={loadState === "error" ? error : null}
        loading={loadState === "loading"}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="PsyAlien ShopSystem overview">
          <PageMark />
          <span className="brand-name">psyalien<span>®</span><small>SHOP SYSTEM</small></span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(Object.keys(pageLabels) as PageId[]).map((page) => (
            <button
              className={`nav-item${activePage === page ? " nav-active" : ""}`}
              key={page}
              type="button"
              onClick={() => navigate(page)}
              aria-current={activePage === page ? "page" : undefined}
            >
              <span className="nav-icon nav-letter" aria-hidden="true">{page === "readers" ? "R" : page === "guide" ? "?" : page[0]?.toUpperCase()}</span>
              <span>{pageLabels[page]}</span>
              {activePage === page && <span className="nav-current-mark" aria-hidden="true" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-mini">
            <span className={`system-led${dashboard?.apiOnline ? " led-online" : ""}`} />
            <span>
              <strong>Local system</strong>
              <small>{dashboard?.apiOnline ? "API connected" : "Connection status"}</small>
            </span>
          </div>
          <div className="sidebar-version">INVENTORY ENGINE <span>·</span> LOCAL</div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span><b>/</b><strong>{pageLabels[activePage]}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`connection-pill${dashboard?.apiOnline ? " is-connected" : ""}`}>
              <span />{dashboard?.apiOnline ? "API online" : loadState === "loading" ? "Checking API" : "API offline"}
            </span>
            <button
              className="icon-button refresh-button"
              type="button"
              onClick={() => void refresh()}
              disabled={loadState === "loading"}
              aria-label={`Refresh ${pageLabels[activePage]}`}
              title="Refresh"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M16.4 8A6.5 6.5 0 0 0 4.8 5.5L3 7.3M3 3.8v3.5h3.5M3.6 12A6.5 6.5 0 0 0 15.2 14.5l1.8-1.8m0 3.5v-3.5h-3.5" />
              </svg>
            </button>
            <button className="button button-quiet signout-button" type="button" onClick={signOut}>
              Sign out
            </button>
            <span className="topbar-date">{new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span>
          </div>
        </header>

        <div className="content-wrap">
          {dashboard && <PageHeading page={activePage} subtitle={pageSubtitle(activePage)} />}

          {error && !needsToken && (
            <div className="error-banner" role="alert">
              <span className="error-symbol" aria-hidden="true">!</span>
              <span><strong>Couldn’t refresh the overview.</strong> {error}</span>
              <button type="button" onClick={() => void refresh()}>Try again</button>
            </div>
          )}

          {loadState === "loading" && !dashboard ? (
            <section className="loading-panel" aria-live="polite">
              <span className="loading-ring" />
              <strong>Connecting to inventory</strong>
              <span>Reading the latest records from your local system.</span>
            </section>
          ) : loadState === "error" && !dashboard ? (
            <section className="locked-panel">
              <div className="error-symbol large-error" aria-hidden="true">!</div>
              <h2>Inventory data unavailable</h2>
              <p>{error ?? "Check that the API is running, then try again."}</p>
              <button className="button button-bright" onClick={() => void refresh()} type="button">Retry connection</button>
            </section>
          ) : activePage === "overview" ? (
            <>
              <section className="metrics-grid" aria-label="Inventory summary">
                <article className="metric-card metric-featured">
                  <div className="metric-topline">
                    <span className="metric-icon"><MetricIcon kind="stock" /></span>
                    <span className="metric-index">01 / QUANTITY</span>
                  </div>
                  <div className="metric-label">Units on hand</div>
                  <div className="metric-value">{loadState === "loading" && !dashboard ? "—" : numberFormat.format(totals.onHand)}</div>
                  <div className="metric-note">Current ledger balance</div>
                  <span className="metric-accent" aria-hidden="true" />
                </article>
                <article className="metric-card">
                  <div className="metric-topline">
                    <span className="metric-icon"><MetricIcon kind="catalog" /></span>
                    <span className="metric-index">02 / CATALOG</span>
                  </div>
                  <div className="metric-label">Products</div>
                  <div className="metric-value">{numberFormat.format(totals.products)}</div>
                  <div className="metric-note">In the product catalog</div>
                </article>
                <article className="metric-card">
                  <div className="metric-topline">
                    <span className="metric-icon"><MetricIcon kind="rfid" /></span>
                    <span className="metric-index">03 / RFID</span>
                  </div>
                  <div className="metric-label">Registered tags</div>
                  <div className="metric-value">{numberFormat.format(totals.tags)}</div>
                  <div className="metric-note">Assigned to catalog products</div>
                </article>
                <article className="update-card">
                  <span className="update-orbit orbit-one" aria-hidden="true" />
                  <span className="update-orbit orbit-two" aria-hidden="true" />
                  <div className="update-kicker">LAST SYNC</div>
                  <div className="update-time">{lastUpdated ? formatDate(lastUpdated.toISOString()) : "Waiting for data"}</div>
                  <div className="update-foot"><span className={loadState === "loading" ? "sync-dot sync-pulse" : "sync-dot"} />{loadState === "loading" ? "Refreshing records" : "Data from local API"}</div>
                </article>
              </section>

              <section className="panel inventory-panel">
                <div className="panel-heading">
                  <div>
                    <div className="section-kicker">STOCK OVERVIEW <span>01</span></div>
                    <h2>Inventory</h2>
                    <p>On-hand quantities and RFID assignment coverage.</p>
                  </div>
                  <div className="panel-count"><span className="count-square" />{numberFormat.format(dashboard?.inventory.length ?? 0)} PRODUCTS</div>
                </div>
                {loadState === "loading" && dashboard && <div className="refresh-line" />}
                {dashboard ? <InventoryTable rows={dashboard.inventory} /> : null}
                <p className="data-note">RFID sightings are historical observations and do not indicate current shelf presence.</p>
              </section>

              {dashboard && (
                <>
                  <ProductCatalogPanel
                    products={dashboard.products}
                    token={activeToken}
                    onRefresh={refresh}
                  />
                  <QuickTagRegister
                    tags={dashboard.tags}
                    products={dashboard.products}
                    scans={dashboard.scans}
                    token={activeToken}
                    onRefresh={refresh}
                  />
                  <TagAssignmentsPanel
                    tags={dashboard.tags}
                    products={dashboard.products}
                    scans={dashboard.scans}
                    token={activeToken}
                    onRefresh={refresh}
                  />
                  <InventorySessionsPanel
                    sessions={dashboard.sessions}
                    token={activeToken}
                    onRefresh={refresh}
                  />
                </>
              )}

              <section className="activity-grid" aria-label="Recent activity">
                <article className="panel activity-panel">
                  <div className="panel-heading panel-heading-compact">
                    <div>
                      <div className="section-kicker">STOCK LEDGER <span>03</span></div>
                      <h2>Recent movements</h2>
                    </div>
                    <span className="activity-count">{dashboard?.movements.length ?? 0} loaded</span>
                  </div>
                  {dashboard && <MovementList movements={dashboard.movements} products={dashboard.products} />}
                </article>
                <article className="panel activity-panel">
                  <div className="panel-heading panel-heading-compact">
                    <div>
                      <div className="section-kicker">RFID INGESTION <span>04</span></div>
                      <h2>Recent scans</h2>
                    </div>
                    <span className="activity-count">{dashboard?.scans.length ?? 0} loaded</span>
                  </div>
                  {dashboard && <ScanList scans={dashboard.scans} />}
                  <p className="privacy-note">Tag identifiers are shortened in this overview.</p>
                </article>
              </section>

              <footer className="page-footer">
                <span><PageMark /> PSYALIEN SHOP SYSTEM</span>
                <span>Stock changes come from the movement ledger, not RFID scans.</span>
              </footer>
            </>
          ) : dashboard ? (
            <section className="screen-content">
              {activePage === "products" && (
                <>
                  <ProductCatalogPanel products={dashboard.products} token={activeToken} onRefresh={refresh} />
                  <QuickTagRegister
                    tags={dashboard.tags}
                    products={dashboard.products}
                    scans={dashboard.scans}
                    token={activeToken}
                    onRefresh={refresh}
                  />
                  <TagAssignmentsPanel
                    tags={dashboard.tags}
                    products={dashboard.products}
                    scans={dashboard.scans}
                    token={activeToken}
                    onRefresh={refresh}
                  />
                </>
              )}
              {activePage === "inventory" && (
                <InventoryMovementPanel
                  inventory={dashboard.inventory}
                  movements={dashboard.movements}
                  products={dashboard.products}
                  token={activeToken}
                  onRefresh={refresh}
                />
              )}
              {activePage === "readers" && <ReadersScreen />}
              {activePage === "settings" && (
                <SettingsScreen
                  apiOnline={dashboard.apiOnline}
                  hasToken={Boolean(activeToken)}
                  loadState={loadState}
                />
              )}
              {activePage === "guide" && <GuideScreen />}
              <footer className="page-footer">
                <span><PageMark /> PSYALIEN SHOP SYSTEM</span>
                <span>Stock changes come from the movement ledger, not RFID scans.</span>
              </footer>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
