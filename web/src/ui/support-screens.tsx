import type { FormEvent } from "react";

type LoadState = "loading" | "ready" | "error";

function PageMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span /><span /><span /><span />
    </span>
  );
}

export function ReadersScreen() {
  return (
    <section className="panel information-panel">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">VERIFIED OPERATING NOTES <span>01</span></div>
          <h2>CF-601 USB reader</h2>
          <p>Experimental Linux workflow documented for the exact CF-601 / CF000701.</p>
        </div>
        <span className="reader-status">EXPERIMENTAL</span>
      </div>
      <div className="information-content">
        <h3>Known workflow</h3>
        <ol>
          <li>Connect the CF-601 and confirm it is configured as <code>CDC_COM</code> and Active Mode (<code>WORKMODE=1</code>).</li>
          <li>Install <code>libusb-1.0</code> and use the approved local device-node access policy.</li>
          <li>Start the API and run a bounded scan with the documented reader ID: <code>npm run cf601:scan -- --duration 5 --reader-id cf601-cf000701</code>.</li>
          <li>To ingest scans, add <code>--api-url http://127.0.0.1:3000/api/v1/scan-events</code>. If API auth is enabled, pass <code>API_TOKEN</code> to the scanner process securely.</li>
        </ol>
        <div className="reader-warning">
          <strong>Limits & safety</strong>
          <p>This Linux-specific tool is experimental, bounded to at most 60 seconds, and requires the vendor SDK for safe stop-on-exit. It reads scan events; it does not write EPCs or change reader settings. No other reader model or firmware is claimed as supported.</p>
        </div>
        <p className="data-note">For setup details and the model-specific SDK location, see the CF-601 section in README.</p>
      </div>
    </section>
  );
}

export function SettingsScreen({
  apiOnline,
  hasToken,
  loadState,
}: {
  apiOnline: boolean;
  hasToken: boolean;
  loadState: LoadState;
}) {
  return (
    <section className="panel information-panel">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">LOCAL CONNECTION <span>01</span></div>
          <h2>Settings & access</h2>
          <p>Connection status and safe configuration guidance. Runtime environment values are not editable here.</p>
        </div>
      </div>
      <div className="settings-list">
        <div><span>Inventory API</span><strong className={apiOnline ? "settings-good" : ""}>{apiOnline ? "Connected" : loadState === "loading" ? "Checking…" : "Unavailable"}</strong></div>
        <div><span>Access in this tab</span><strong>{hasToken ? "Bearer token held in memory" : "No bearer token supplied"}</strong></div>
        <div><span>Authentication model</span><strong>Shared API_TOKEN · not per-user</strong></div>
      </div>
      <div className="information-content settings-guidance">
        <h3>Configure the local service</h3>
        <p>Set API_TOKEN in the project’s machine-local <code>.env</code> file, then restart the API process. Keep that file private and out of source control. Use <code>.env.example</code> only as a credential-free reference.</p>
        <p>When the API requires a token, enter it at login. It is kept only in page memory, sent over same-origin API requests, and cleared when you sign out or reload. Use HTTPS and trusted local access controls if the service is exposed beyond localhost.</p>
        <p>These settings are informational: the dashboard cannot inspect or change the server’s environment configuration.</p>
      </div>
    </section>
  );
}

export function GuideScreen() {
  return (
    <section className="panel information-panel">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">QUICK START <span>01</span></div>
          <h2>User guide / FAQ</h2>
          <p>Everyday workflows for the local inventory system.</p>
        </div>
      </div>
      <div className="faq-list">
        <details open>
          <summary>How do I log in?</summary>
          <p>If the API requires access, enter the shared API_TOKEN configured by the operator. It is held in memory only, is not a user account, and disappears on reload or sign-out.</p>
        </details>
        <details>
          <summary>How do I add or update a product?</summary>
          <p>Open Products, create a unique SKU and name, or use Edit to change those fields. Product identity, inventory balance, and RFID assignment history stay intact.</p>
        </details>
        <details>
          <summary>How do I change stock?</summary>
          <p>Open Inventory and record a receipt, sale, write-off, or adjustment with a quantity delta. Receipts are positive; sales/write-offs are negative. Changes are written to the stock ledger.</p>
        </details>
        <details>
          <summary>Do RFID reads change stock or write to a tag?</summary>
          <p>No. Reads are observations only. Assign EPC maps a scanned code to a catalog product in this database; it never writes to a physical tag and does not change stock.</p>
        </details>
        <details>
          <summary>How do I run a stocktake?</summary>
          <p>In Overview, start an inventory session using the reader ID, run a bounded scan using that same ID, then close the session and review the report. A missing read is not proof that an item is absent.</p>
        </details>
      </div>
    </section>
  );
}

export function LoginScreen({
  tokenInput,
  onChange,
  onSubmit,
  errorMessage,
  loading,
}: {
  tokenInput: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  errorMessage: string | null;
  loading: boolean;
}) {
  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-brand"><PageMark /><span className="brand-name">psyalien<span>®</span><small>SHOP SYSTEM</small></span></div>
        <div className="eyebrow"><span className="eyebrow-line" />LOCAL INVENTORY ACCESS</div>
        <h1>Sign in<span className="heading-period">.</span></h1>
        <p>Enter the shared API token configured for this local system. It is not a personal account or password.</p>
        <form className="login-form" onSubmit={onSubmit}>
          <label htmlFor="login-token">API token</label>
          <input
            id="login-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            value={tokenInput}
            onChange={(event) => onChange(event.target.value)}
          />
          <button className="button button-bright" type="submit" disabled={loading || !tokenInput.trim()}>
            {loading ? "Connecting…" : "Connect"}
          </button>
          {errorMessage && <span className="token-error" role="alert">{errorMessage}</span>}
        </form>
        <p className="login-note">Token remains in this tab’s memory only. It is cleared when you sign out or reload.</p>
      </section>
    </main>
  );
}
