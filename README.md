# PsyAlien ShopSystem

Self-hosted TypeScript inventory engine for RFID-based product tracking. The
current MVP provides a local HTTP API, SQLite persistence, EPC-to-product
mapping, and MQTT scan-event ingestion. No ERP system or paid cloud service is
required to run it locally.

```
sudo modprobe cdc_acm
```
## Requirements

- Node.js 24
- npm
- A C/C++ build toolchain if a platform-specific SQLite binary is not available
- Optional: an MQTT broker such as Mosquitto for live gateway ingestion

## Run locally

```sh
npm ci
npm run dev
```

The API listens on `http://127.0.0.1:3000`; SQLite creates
`data/psyalien.sqlite` on first start. Copy `.env.example` to `.env` to
customize settings. The HTTP API binds to localhost by default.
If binding beyond localhost, set a strong `API_TOKEN` of at least 32 characters;
protected API requests must send the configured token in the `Authorization`
header using the `Bearer` scheme. The `/health` endpoint remains available
without a token.

## Operator overview

Run the API and the Vite frontend in separate terminals:

```sh
npm run dev
npm run web:dev
```

Open the Vite URL printed in the second terminal (normally
`http://localhost:5173`). Its development proxy forwards `/api` and `/health`
to `http://127.0.0.1:3000`, so browser requests remain same-origin. If the API
is protected by `API_TOKEN`, enter the shared token on the sign-in screen. This
is not per-user authentication. The token is held in page memory only and is
cleared on sign-out or reload.

Use the navigation to open Overview, Products, Inventory, Readers &
integrations, Settings, or User guide / FAQ. Products can be searched, added,
and edited by SKU or name; these changes retain product identity and history.
Inventory changes are explicit receipt, sale, write-off, or adjustment entries
in the stock ledger; RFID scans never change quantities. Settings gives safe
`.env` guidance but does not edit runtime configuration.

The overview can start an inventory session for a reader, show its
tag-reconciliation report, and close it to freeze that report. Closing a session
does not change stock. A missing read is not proof that an item is absent.
The tag assignment panel binds a scanned EPC to a selected catalog product and
can unassign it while preserving assignment history. It does not write to the
physical RFID tag.

`npm run web:build` creates the production UI in `web/dist`; the API does not
serve these files. For production, serve the built UI and API behind one
same-origin host: route UI paths to the static frontend and `/api/*` plus
`/health` to the Node API. Configure HTTPS and deployment access controls at
that host/proxy. Do not expose the API cross-origin or embed its token in the
frontend bundle.

The intended public hostname is `psyalien.debug.org.ua`, to be configured in
DNS later. It is not live or configured by this repository. Do not expose the
API through a public reverse proxy until HTTPS, authentication, and deployment
access controls have been configured and tested; a localhost bind alone does
not protect an API exposed by a proxy.

To enable the MQTT subscriber, configure `MQTT_URL`, `MQTT_TOPIC_TAGS`, and
optionally MQTT username/password in `.env`, then set:

```dotenv
MQTT_ENABLED=true
```

The broker should use persistent sessions and durable storage for QoS 1
deliveries. The engine acknowledges a scan only after its SQLite transaction
has succeeded or the same event has already been stored.

### Chafon CF-601 USB on Linux

The CF-601's CDC descriptors are inconsistent, so Linux does not create a
`/dev/ttyACM*` port for it. The experimental Linux reader uses libusb to read
CDC Data interface 3 (bulk IN endpoint `0x87`) and the vendor SDK to verify the
current mode and stop inventory. It does not change reader settings or start
RF; the device must already be configured as `CDC_COM` (`0x04`) and Active Mode
(`WORKMODE=1`). The SDK shared library is required for safe stop-on-exit and is
looked up beside this project at
`../UHF Desk Reader SDK/Sample/Linux_QT/Release/libCFApi.so`; override it with
`CF601_SDK_LIBRARY` if it is elsewhere.

Install `libusb-1.0` and grant the current user temporary access to the device
nodes using the system's approved udev/ACL policy. Then run a bounded scan:

```sh
npm run cf601:scan -- --duration 5 --reader-id cf601-cf000701
```

The tool validates the vendor CRC, prints JSON scan events to stdout, and
deduplicates repeat reads of the same EPC for one second. To store events in a
running local API instead, add `--api-url http://127.0.0.1:3000/api/v1/scan-events`.
If the API is protected, provide `API_TOKEN` in the environment. The tool
checks the current reader mode and reports whether its buzzer is enabled; a
reader with `BUZZERTIME=1` may beep repeatedly during active inventory. On exit
it sends the vendor `InventoryStop` command. This driver is experimental and
Linux-specific; it does not replace the missing CDC tty driver.

To register a scanned label, refresh the dashboard after scanning. Its
**Assign EPC tags** panel lists recent unassigned reads; choose **Use EPC**,
select the product, and assign it. EPCs already assigned to a product are
excluded from that quick-pick list.

For a stocktake, start an inventory session in the dashboard first, then run
the bounded scanner with the exact same `--reader-id`:

```sh
npm run cf601:scan -- --duration 5 --reader-id cf601-cf000701 \
  --api-url http://127.0.0.1:3000/api/v1/scan-events
```

Wait for the scanner to stop, then close the session and review the report. A
scan run is limited to 60 seconds.

### Writing an EPC to a physical tag

The application does not write to physical tags. The supplied Chafon Desk
Reader SDK source shows the model-specific EPC update sequence: select by the
tag's current EPC with `SetSelectMask`, then call `WriteTag` for the UII/EPC
bank starting at word 2. The vendor dialog defaults the access password to
`00000000`; this is not a guarantee that a tag has that password. The sample
source (`../UHF Desk Reader SDK/Source Code/Desk Reader/ViewModels/UpdateEpcDialogViewModel.cs`)
does not provide a sufficiently reliable success check to automate this
sequence in this application yet.

Until a dedicated, tested writer is implemented:

1. Use only a spare tag and the Chafon CF-601 Desk Reader software/SDK for the
   exact CF-601 model. Keep exactly one tag in the reader's field.
2. Read and record that tag's current EPC. In the vendor EPC-update dialog,
   select that exact old EPC and enter a new 24-character hex EPC (12 bytes),
   matching the current EPC length for this initial bench test. Use the default
   access password only if it is known to be unchanged.
3. Do not use batch write, lock, or kill operations. After writing, use
   `npm run cf601:scan -- --duration 5 --reader-id cf601-cf000701` and verify
   that the new EPC is read and the old EPC is no longer read from the isolated
   tag.

This bench procedure is not integrated with product assignment and has not
been verified on a physical write in this project. Assigning an EPC in the
dashboard only changes the local EPC-to-product mapping; it never writes to a
tag.

## API

- `GET /health` — health check.
- `GET /api/v1/products` — list products.
- `POST /api/v1/products` — create a product from `sku` and `name`.
- `PUT /api/v1/products/:productId` — update a product's `sku` and `name`;
  identity and creation time are retained and SKU collisions are rejected.
- `GET /api/v1/inventory` — per-product registered tag counts, tags seen at
  least once, most recent observation timestamp, and on-hand count from the
  stock-movement ledger.
- `GET /api/v1/inventory/reconciliation?readerId=...&from=...&to=...` —
  compare active EPC assignments with distinct tags seen by one reader during
  an explicit ISO 8601 time window (maximum 31 days).
- `POST /api/v1/inventory/sessions` — start an inventory session for a
  `readerId`; only one open session is allowed per reader.
- `GET /api/v1/inventory/sessions?limit=100` — list recent sessions.
- `GET /api/v1/inventory/sessions/:sessionId` — get the report for a session.
- `POST /api/v1/inventory/sessions/:sessionId/close` — close a session and
  freeze its report.
- `GET /api/v1/inventory/movements?limit=100&productId=...` — append-only
  inventory movement history.
- `POST /api/v1/inventory/movements` — record a receipt, sale, writeoff, or
  adjustment with an idempotent `movementId`.
- `GET /api/v1/tags` — list EPC-to-product mappings.
- `POST /api/v1/tags` — map `epc` to an existing `productId`.
- `DELETE /api/v1/tags/:epc` — unassign an EPC while retaining its assignment
  history.
- `GET /api/v1/tags/history?limit=100&epc=...` — list tag assignment and
  unassignment events.
- `GET /api/v1/scan-events?limit=100&epc=...` — list recent scans.
- `POST /api/v1/scan-events` — validate and store a scan event.

Example product:

```sh
curl -X POST http://127.0.0.1:3000/api/v1/products \
  -H 'content-type: application/json' \
  -d '{"sku":"SKU-001","name":"Example product"}'
```

MQTT and scan API events use the same JSON contract:

```json
{
  "eventId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "epc": "E28068940000502C6FE3BCAE",
  "readerId": "gateway-01",
  "antennaId": 1,
  "rssi": -54,
  "observedAt": "2026-10-26T02:30:00Z"
}
```

Gateways must reuse `eventId` when retrying a delivery. Repeated identical
events are accepted idempotently; reusing an ID for different scan data returns
a conflict. The first release records sightings but deliberately does not
adjust stock quantities from scans alone.

Stock changes are explicit movements and never inferred from scans. Send a
positive `quantityDelta` for a receipt, a negative value for a sale or writeoff,
and either sign for an adjustment. The movement ID must be reused for retries.
The API rejects a movement that would make stock negative. Movement history is
append-only through the API; corrections should be new adjustment movements.
A `sale` entry is an inventory record, not proof of payment or a POS-confirmed
sale; POS integration has not been implemented.

Tag bindings are treated as the current assignment, while
`/api/v1/tags/history` retains assignment and unassignment events. Reassign a
tag by explicitly unbinding it and binding it to the new product. Existing tag
bindings are backfilled into the history during database migration.

Example receipt:

```sh
curl -X POST http://127.0.0.1:3000/api/v1/inventory/movements \
  -H 'content-type: application/json' \
  -d '{"movementId":"b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11","productId":"PRODUCT_UUID","type":"receipt","quantityDelta":12,"reference":"delivery-42"}'
```

The inventory summary's RFID observation fields report historical observations,
not current shelf presence. It does not establish checkout or theft; those
require reader-zone and point-of-sale workflows that have not yet been
configured.

The reconciliation endpoint is a tag-read comparison, not an authoritative
physical stocktake: it reports currently assigned EPCs seen or not seen by the
specified reader in the time window, plus currently unassigned EPCs observed by
that reader. Duplicate reads of an EPC count once. It does not change stock,
and readers not dedicated to a stocktake may cause misleading results. Run it
only for a known reader and an intentional scan window.

Inventory sessions capture the active EPC-to-product assignments when opened
and the matching scan-event IDs when closed. This keeps a closed report stable
if tags are later reassigned or delayed events arrive after closure. An open
session report uses the captured assignment baseline and current events through
the report time. Session reconciliation remains a reader-based comparison; it
does not prove physical presence or theft and never changes stock.

## Cloudflare D1

The schema in [`migrations/`](./migrations) uses SQLite-compatible SQL and is
kept suitable for a future Cloudflare D1 adapter. The application currently
uses `better-sqlite3` in Node.js and is **not** a Cloudflare Worker; a D1
storage adapter, Worker entrypoint, and deployment configuration remain future
work.

## Development checks

```sh
npm run typecheck
npm test
npm run test:cf601
npm run build
```

## Licensing

The application is ISC-licensed. MQTT.js and better-sqlite3 are MIT-licensed.
Node.js and SQLite are available without a subscription. Self-hosting still
requires hardware, electricity, and network connectivity.
