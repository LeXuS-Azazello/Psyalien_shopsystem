---
name: esp32-gateway
description: Build or troubleshoot ESP32-C6/ESP32-S3 gateway firmware that connects RFID readers or sensors to the shop backend. Use for board selection, UART wiring, firmware structure, provisioning, telemetry, or device-to-server integration.
---

# ESP32 Gateway

Treat the gateway as a boundary between hardware protocols and the shop
application. Keep firmware responsibilities out of the TypeScript backend.

## Workflow

1. Confirm the exact board, module revision, framework/toolchain, power supply,
   peripherals, pin assignments, and intended role. C6 and S3 are not
   interchangeable; verify peripheral support from their primary docs.
2. Check reader/sensor voltage levels, UART settings, boot-strap pins, antenna
   requirements, current draw, thermal limits, and enclosure before wiring or
   prolonged operation.
3. Separate device drivers, event normalization, transport, and configuration.
   Keep protocol bytes out of application-facing contracts.
4. Give each event a stable ID and include device identity, observation time,
   and only the measurements the backend needs. Validate at both gateway and
   server boundaries.
5. Buffer boundedly during network outages, retry safely, and make server
   delivery idempotent. Surface dropped events and device faults explicitly.
6. Keep credentials out of firmware source, logs, examples, and checked-in
   configuration. Use a provisioning and rotation approach appropriate to the
   selected hardware.
7. Test parsers and state transitions on host/simulation first; mark a build as
   hardware-verified only with captured evidence from the target board.

## Integration boundaries

- Keep ESP-NOW, Wi-Fi/IP, MQTT, UART, and sensor protocols as distinct transports.
- Do not assume a link-layer delivery is durable backend ingestion.
- Keep firmware in a separate project (for example `firmware/`) and publish a
  versioned event contract for the Node.js service.
- Gate hardware access and live transmission; never flash or alter a connected
  device without clear authorization.

## Planned RFID bridge in this project

The proposed first path is Chafon MU910-M UART → ESP32 → Wi-Fi → ShopSystem via
MQTT or HTTP. The exact ESP32 board and firmware environment are not yet
specified. Before wiring, verify the module's UART pins and logic levels,
115200-bps setting, grounding, supply voltage/current, RF antenna connection,
and host protocol against the manuals for the exact revisions. Do not derive
MU910-M commands from the separate MU60x library.

The CF-601 is a separate USB desktop reader for the host computer and should use
its confirmed virtual-COM protocol; it is not part of this UART bridge.
