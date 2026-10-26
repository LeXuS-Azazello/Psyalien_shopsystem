# PsyAlien ShopSystem

Do not do long files. No more then 1000 lines.
before install anythig, check m
## Project status and goals

This repository is the starting point for a TypeScript inventory and shop-system
backend. Keep device integrations isolated from the inventory domain, and treat
hardware-specific behavior as unverified until it has been checked against the
exact model, firmware, and its primary documentation.

The repository currently contains reference material for the Chafon MU60x series
and an old Node.js driver for the CF-RU5102. Neither reference is proof that the
same protocol, commands, or serial settings apply to the MU910-M or CF-601.
Do not vendor or depend on the old driver as the implementation.

## Technology choices

- Node.js 24 and TypeScript 5.x, ESM (`NodeNext`) with strict type checking.
- npm; commit the lockfile when dependencies are introduced.
- This repository owns its inventory engine and Node.js HTTP API; do not add
  Frappe, ERPNext, or another external ERP dependency.
- SQLite is the local system of record. Keep SQL portable for a future Cloudflare
  D1 adapter; D1 is a later deployment target, not a current runtime dependency.
- MQTT.js is used for RFID gateway ingestion.
- Node built-ins and `node:test` first. Add runtime dependencies only for a
  concrete need.
- ESP32-C6 and ESP32-S3 firmware is a separate C++/Arduino or PlatformIO
  component; do not put firmware responsibilities in the TypeScript backend.
- Keep transports and hardware drivers behind typed interfaces. Do not add a
  heavy web framework, ORM, or abandoned Chafon package without an explicit
  design decision.

## Hardware and integration scope

| Device or technology | Intended role | Notes |
| --- | --- | --- |
| Chafon CF-601 / CF000701 | USB/serial RFID reader | Confirm the exact model label, protocol, and serial settings before implementing. |
| Chafon MU910-M | UHF RFID reader module | UART is on the ESP32 side; confirm the reader's own protocol and configuration from its documentation. |
| Chafon CF-RA9002 | UHF antenna | Passive RF component, not a reader or network device; verify connector, cable, and reader compatibility. |
| ESP32-C6, ESP32-S3 | Embedded gateways/sensors | Select board roles and firmware targets explicitly; do not assume identical capabilities. |
| ESP-NOW | ESP32 device-to-device transport | Keep radio transport separate from backend ingestion and document the gateway path. |
| RTSP CCTV | Camera stream integration | Keep stream URLs and credentials out of source control and logs. |
| CSI, RuView, mmWave | Experimental sensing inputs | Treat as separate, opt-in integrations; do not infer RFID identity from sensing data. Document data handling and privacy implications before enabling collection. |

The product and hardware names above describe intended scope, not completed
support. Hardware integrations default to disabled.

## Suggested boundaries

- `src/config.ts`: validated environment configuration.
- `src/http/`: small built-in HTTP API; no device protocol logic.
- `src/drivers/`: device protocol and transport implementations, separated by
  exact reader model.
- `src/storage/`: SQLite adapter and D1-portable persistence boundary.
- `src/integrations/mqtt/`: event validation and MQTT gateway ingestion.
- `firmware/`: independent ESP32 firmware projects, if/when added.
- `migrations/`: SQLite-compatible schema migrations, kept portable for D1.
- `test/`: protocol, domain, and service tests; hardware tests must be opt-in.
- `docs/`: confirmed wiring and protocol notes, with source and date.

Adapt this outline as the repository grows; do not create placeholder layers
without a use case.

## Engineering rules

- Keep raw bytes and transport-specific payloads inside their driver boundaries.
- Validate every external input before passing it to domain logic.
- Do not silently swallow communication errors. Return typed errors or report
  them through the established application error path.
- Protocol encoders/decoders should be pure functions and have tests for valid,
  malformed, truncated, and checksum-invalid frames.
- Add a test with each behavior change. Keep real-hardware tests disabled by
  default and clearly gated.
- Never log credentials, full RTSP URLs, or sensitive tag/customer data.
- Acknowledge MQTT QoS 1 deliveries only after the scan event is durably stored
  or recognized as an idempotent duplicate. Reject malformed events without
  logging their payload.
- Use `unknown` and narrow types; do not introduce `any`.
- Use `.ts` extensions for relative imports; the build rewrites them to `.js`.
- Do not claim support for a reader based only on another Chafon model's
  protocol. Record verified commands and byte formats in `docs/` with the
  exact device, firmware, source, and date.

## Environment configuration

`.env` is machine-local and must not be committed. Keep `.env.example` free of
credentials and synchronized with configuration fields used by the application.
Use empty values for unavailable endpoints and keep optional hardware features
disabled until configured and tested. Never place real secrets in examples,
tests, logs, or documentation.

## Agent workflow

1. Read relevant source code and device-specific documentation before changing a
   driver. Treat neighboring reference directories as read-only source material.
2. Confirm the exact device model and protocol before adding or changing command
   bytes, baud rates, or wiring assumptions.
3. Add or update focused tests and directly related documentation.
4. Run the relevant checks (`npm run typecheck`, `npm test`, and `npm run build`
   when applicable) and report hardware checks that could not be performed.
