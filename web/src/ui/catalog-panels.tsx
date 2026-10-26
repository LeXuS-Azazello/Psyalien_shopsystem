import { useMemo, useState, type FormEvent } from "react";
import {
  bindTag,
  createProduct,
  unbindTag,
  updateProduct,
  type DashboardData,
  type ScanEvent,
  type Tag,
} from "../api.ts";

function formatDate(value: string | null | undefined): string {
  if (!value) return "No recorded sighting";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function ProductCatalogPanel({
  products,
  token,
  onRefresh,
}: {
  products: DashboardData["products"];
  token: string;
  onRefresh: () => Promise<void>;
}) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editSku, setEditSku] = useState("");
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? products.filter((product) =>
        `${product.sku} ${product.name}`.toLocaleLowerCase().includes(query))
      : products;
  }, [products, search]);

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await createProduct(token, sku.trim(), name.trim());
      setSku("");
      setName("");
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not add the product.");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(product: DashboardData["products"][number]) {
    setEditingProductId(product.id);
    setEditSku(product.sku);
    setEditName(product.name);
    setActionError(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProductId) return;

    setBusy(true);
    setActionError(null);
    try {
      await updateProduct(token, editingProductId, editSku.trim(), editName.trim());
      setEditingProductId(null);
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not update the product.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel product-catalog-panel">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">PRODUCT MASTER DATA <span>02</span></div>
          <h2>Product catalog</h2>
          <p>Manage the names and SKUs used by inventory and RFID assignments.</p>
        </div>
        <div className="panel-count"><span className="count-square" />{products.length} PRODUCTS</div>
      </div>

      <form className="product-create-form" onSubmit={(event) => void addProduct(event)}>
        <div className="product-form-intro">
          <strong>Add a product</strong>
          <span>Changes are saved to the local inventory database.</span>
        </div>
        <label>
          <span>SKU</span>
          <input
            name="sku"
            autoComplete="off"
            maxLength={100}
            placeholder="e.g. JACKET-042"
            required
            value={sku}
            onChange={(event) => setSku(event.target.value)}
          />
        </label>
        <label>
          <span>Product name</span>
          <input
            name="name"
            autoComplete="off"
            maxLength={200}
            placeholder="e.g. Utility field jacket"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="button button-bright" type="submit" disabled={busy || !sku.trim() || !name.trim()}>
          Add product
        </button>
      </form>

      {actionError && <div className="session-error" role="alert">{actionError}</div>}
      <div className="catalog-search">
        <label htmlFor="product-search">Search products</label>
        <input
          id="product-search"
          type="search"
          placeholder="Search by SKU or name"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span>{visibleProducts.length} of {products.length}</span>
      </div>

      {editingProductId && (
        <form className="product-edit-form" onSubmit={(event) => void saveEdit(event)}>
          <div className="product-form-intro">
            <strong>Edit product</strong>
            <span>Existing inventory, tag assignments, and history remain attached.</span>
          </div>
          <label>
            <span>SKU</span>
            <input
              name="editSku"
              autoComplete="off"
              maxLength={100}
              required
              value={editSku}
              onChange={(event) => setEditSku(event.target.value)}
            />
          </label>
          <label>
            <span>Product name</span>
            <input
              name="editName"
              autoComplete="off"
              maxLength={200}
              required
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
          </label>
          <div className="product-edit-actions">
            <button className="button button-bright" type="submit" disabled={busy || !editSku.trim() || !editName.trim()}>
              Save changes
            </button>
            <button
              className="button button-quiet"
              type="button"
              onClick={() => setEditingProductId(null)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {products.length === 0 ? (
        <div className="empty-state">
          <span className="empty-mark" aria-hidden="true">＋</span>
          <strong>Your catalog is ready for its first product</strong>
          <p>Add a SKU and product name to start tracking stock.</p>
        </div>
      ) : visibleProducts.length === 0 ? (
        <div className="compact-empty catalog-no-results">No products match “{search}”.</div>
      ) : (
        <div className="table-scroll">
          <table className="product-catalog-table">
            <thead>
              <tr><th scope="col">SKU</th><th scope="col">Product name</th><th scope="col">Added</th><th scope="col">Action</th></tr>
            </thead>
            <tbody>
              {visibleProducts.map((product) => (
                <tr key={product.id}>
                  <td className="mono">{product.sku}</td>
                  <td><strong>{product.name}</strong></td>
                  <td>{formatDate(product.createdAt)}</td>
                  <td>
                    <button
                      className="button button-quiet session-action"
                      type="button"
                      onClick={() => beginEdit(product)}
                      disabled={busy}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="data-note">Editing a product changes only its SKU and name. Stock movement and tag history are retained.</p>
    </section>
  );
}

export function TagAssignmentsPanel({
  tags,
  products,
  scans,
  token,
  onRefresh,
}: {
  tags: Tag[];
  products: DashboardData["products"];
  scans: ScanEvent[];
  token: string;
  onRefresh: () => Promise<void>;
}) {
  const [epc, setEpc] = useState("");
  const [productId, setProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const productNames = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const unassignedScans = useMemo(() => {
    const assignedEpcs = new Set(tags.map((tag) => tag.epc));
    const seenEpcs = new Set<string>();
    return scans.filter((scan) => {
      if (assignedEpcs.has(scan.epc) || seenEpcs.has(scan.epc)) return false;
      seenEpcs.add(scan.epc);
      return true;
    });
  }, [scans, tags]);

  async function assignTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEpc = epc.replace(/\s+/g, "").toUpperCase();
    if (!/^[0-9A-F]{4,128}$/.test(normalizedEpc) || normalizedEpc.length % 2 !== 0) {
      setActionError("EPC must be 2 to 64 bytes of hexadecimal data.");
      return;
    }
    if (!productId) {
      setActionError("Select a product before assigning this EPC.");
      return;
    }

    setBusy(true);
    setActionError(null);
    try {
      await bindTag(token, normalizedEpc, productId);
      setEpc("");
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not assign the EPC.");
    } finally {
      setBusy(false);
    }
  }

  async function removeAssignment(tag: Tag) {
    const product = productNames.get(tag.productId);
    if (!window.confirm(`Unassign EPC ${tag.epc} from ${product?.name ?? "this product"}?`)) {
      return;
    }

    setBusy(true);
    setActionError(null);
    try {
      await unbindTag(token, tag.epc);
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not unassign the EPC.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel tag-assignments-panel">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">TAG LIFECYCLE <span>03</span></div>
          <h2>Assign EPC tags</h2>
          <p>Bind a scanned EPC to a catalog product. This does not write to the physical tag.</p>
        </div>
        <div className="panel-count"><span className="count-square" />{tags.length} ASSIGNED</div>
      </div>

      <form className="tag-assignment-form" onSubmit={(event) => void assignTag(event)}>
        <div className="tag-form-field">
          <label htmlFor="tag-epc">Scanned EPC</label>
          <input
            id="tag-epc"
            name="epc"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={128}
            placeholder="E28068940000402C6FE3C0AE"
            value={epc}
            onChange={(event) => setEpc(event.target.value)}
          />
        </div>
        <div className="tag-form-field">
          <label htmlFor="tag-product">Product</label>
          <select
            id="tag-product"
            name="productId"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">Select a product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.sku} · {product.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="button button-bright"
          type="submit"
          disabled={busy || !epc.trim() || !productId || products.length === 0}
        >
          Assign tag
        </button>
      </form>

      {unassignedScans.length > 0 && (
        <div className="unassigned-scans">
          <div className="unassigned-scans-heading">
            <strong>Recently read, unassigned EPCs</strong>
            <span>Choose a read to fill the EPC field</span>
          </div>
          <ul>
            {unassignedScans.slice(0, 5).map((scan) => (
              <li key={scan.epc}>
                <span className="mono">{scan.epc}</span>
                <span>{scan.readerId} · {formatDate(scan.observedAt)}</span>
                <button
                  className="button button-quiet session-action"
                  type="button"
                  onClick={() => {
                    setEpc(scan.epc);
                    setActionError(null);
                  }}
                  disabled={busy}
                >
                  Use EPC
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {products.length === 0 && (
        <p className="data-note tag-note">Add a product before assigning a tag.</p>
      )}
      {actionError && <div className="session-error" role="alert">{actionError}</div>}

      {tags.length === 0 ? (
        <div className="compact-empty session-empty">No EPC tags are assigned yet.</div>
      ) : (
        <div className="table-scroll">
          <table className="tag-assignment-table">
            <thead>
              <tr><th scope="col">EPC</th><th scope="col">Product</th><th scope="col">Assigned</th><th scope="col">Action</th></tr>
            </thead>
            <tbody>
              {tags.map((tag) => {
                const product = productNames.get(tag.productId);
                return (
                  <tr key={tag.epc}>
                    <td className="mono">{tag.epc}</td>
                    <td>{product ? `${product.sku} · ${product.name}` : "Product unavailable"}</td>
                    <td>{formatDate(tag.createdAt)}</td>
                    <td>
                      <button
                        className="button button-quiet session-action"
                        type="button"
                        onClick={() => void removeAssignment(tag)}
                        disabled={busy}
                      >
                        Unassign
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function shortEpc(epc: string): string {
  return epc.length > 14 ? `${epc.slice(0, 8)}…${epc.slice(-4)}` : epc;
}

export function QuickTagRegister({
  tags,
  products,
  scans,
  token,
  onRefresh,
}: {
  tags: Tag[];
  products: DashboardData["products"];
  scans: ScanEvent[];
  token: string;
  onRefresh: () => Promise<void>;
}) {
  const [epc, setEpc] = useState("");
  const [productName, setProductName] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingEpc, setEditingEpc] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const productNames = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const tagByEpc = useMemo(
    () => new Map(tags.map((tag) => [tag.epc, tag])),
    [tags],
  );
  const unassignedScans = useMemo(() => {
    const assignedEpcs = new Set(tags.map((tag) => tag.epc));
    const seenEpcs = new Set<string>();
    return scans.filter((scan) => {
      if (assignedEpcs.has(scan.epc) || seenEpcs.has(scan.epc)) return false;
      seenEpcs.add(scan.epc);
      return true;
    });
  }, [scans, tags]);

  async function registerTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEpc = epc.replace(/\s+/g, "").toUpperCase();
    if (!/^[0-9A-F]{4,128}$/.test(normalizedEpc) || normalizedEpc.length % 2 !== 0) {
      setActionError("EPC must be valid hexadecimal (2–64 bytes).");
      return;
    }
    setBusy(true);
    setActionError(null);
    setSuccess(null);
    try {
      const existing = tagByEpc.get(normalizedEpc);
      let productId: string;
      if (existing) {
        productId = existing.productId;
        setEditingEpc(normalizedEpc);
        const product = productNames.get(existing.productId);
        setEditName(product?.name ?? "");
        setSuccess(`Tag ${shortEpc(normalizedEpc)} already assigned. Edit below to rename.`);
      } else {
        const sku = `RFID-${normalizedEpc.slice(-8)}`;
        const name = productName.trim() || `Tag ${normalizedEpc.slice(-8)}`;
        const product = await createProduct(token, sku, name);
        await bindTag(token, normalizedEpc, product.id);
        productId = product.id;
        setSuccess(`Tag ${shortEpc(normalizedEpc)} registered as ${name}.`);
      }
      setEpc("");
      setProductName("");
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not register the tag.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingEpc) return;
    const tag = tagByEpc.get(editingEpc);
    if (!tag) return;
    setBusy(true);
    setActionError(null);
    try {
      const product = productNames.get(tag.productId);
      await updateProduct(token, tag.productId, product?.sku ?? `RFID-${editingEpc.slice(-8)}`, editName.trim() || `Tag ${editingEpc.slice(-8)}`);
      setEditingEpc(null);
      setSuccess(`Product renamed.`);
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not rename the product.");
    } finally {
      setBusy(false);
    }
  }

  function useScan(scan: ScanEvent) {
    setEpc(scan.epc);
    setActionError(null);
    setSuccess(null);
  }

  return (
    <section className="panel quick-register-panel">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">QUICK TAG REGISTER <span>04</span></div>
          <h2>Register scanned tag</h2>
          <p>Scan an EPC. Unknown tags are created as products automatically. Known tags can be renamed.</p>
        </div>
      </div>

      <form className="tag-assignment-form" onSubmit={(event) => void registerTag(event)}>
        <div className="tag-form-field">
          <label htmlFor="quick-epc">Scanned EPC</label>
          <input
            id="quick-epc"
            name="epc"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={128}
            placeholder="E28068940000402C6FE3C0AE"
            value={epc}
            onChange={(event) => setEpc(event.target.value)}
          />
        </div>
        <div className="tag-form-field">
          <label htmlFor="quick-name">Product name <span>optional</span></label>
          <input
            id="quick-name"
            name="name"
            autoComplete="off"
            maxLength={200}
            placeholder="e.g. Utility jacket"
            value={productName}
            onChange={(event) => setProductName(event.target.value)}
          />
        </div>
        <button
          className="button button-bright"
          type="submit"
          disabled={busy || !epc.trim()}
        >
          {busy ? "Registering…" : "Register tag"}
        </button>
      </form>

      {actionError && <div className="session-error" role="alert">{actionError}</div>}
      {success && <div className="movement-success" role="status">{success}</div>}

      {unassignedScans.length > 0 && (
        <div className="unassigned-scans">
          <div className="unassigned-scans-heading">
            <strong>Recently read, unassigned EPCs</strong>
            <span>Tap to fill the EPC field</span>
          </div>
          <ul>
            {unassignedScans.slice(0, 8).map((scan) => (
              <li key={scan.epc}>
                <span className="mono">{shortEpc(scan.epc)}</span>
                <span>{scan.readerId} · {formatDate(scan.observedAt)}</span>
                <button
                  className="button button-quiet session-action"
                  type="button"
                  onClick={() => useScan(scan)}
                  disabled={busy}
                >
                  Use EPC
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editingEpc && (
        <form className="product-edit-form" onSubmit={(event) => void saveEdit(event)}>
          <div className="product-form-intro">
            <strong>Rename product</strong>
            <span>Changes only the catalog name; history stays intact.</span>
          </div>
          <label>
            <span>Product name</span>
            <input
              name="editName"
              autoComplete="off"
              maxLength={200}
              required
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
          </label>
          <div className="product-edit-actions">
            <button className="button button-bright" type="submit" disabled={busy || !editName.trim()}>
              Save name
            </button>
            <button
              className="button button-quiet"
              type="button"
              onClick={() => setEditingEpc(null)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

