# Cloudflare D1 migration path

Cloudflare D1 is a later deployment target, not part of the current runtime.
The current server uses `better-sqlite3` and a Node.js HTTP server; it cannot
be deployed unchanged as a Cloudflare Worker.

The shared SQL schema lives in `migrations/0001_initial.sql` and intentionally
uses SQLite-compatible tables, keys, indexes, and text timestamps. A D1
deployment will still need:

1. An asynchronous `InventoryStore` implementation using D1 prepared statements and
   `batch`/transaction semantics.
2. A Worker HTTP entrypoint and deployment configuration.
3. A separate MQTT-to-Worker delivery design. Cloudflare Workers do not provide
   a general-purpose TCP MQTT client; the local Node gateway/bridge can publish
   to a Worker HTTPS endpoint, or a broker-supported webhook can be used.
4. Cloudflare account setup and D1 database provisioning.

Keep product/tag/event behavior behind the storage interface so a D1 adapter
can preserve idempotency without changing domain behavior. Do not add Cloudflare
credentials or pretend a deployed D1 instance exists in the local setup.
