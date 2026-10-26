---
name: uhf-rfid
description: Design, implement, or troubleshoot UHF RFID tag workflows, EPC assignments, reader/antenna integrations, and scan-event ingestion for this shop system. Use whenever a task involves UHF tags, RFID readers, Chafon devices, inventory reads, or RFID protocol bytes.
---

# UHF RFID

Keep reader-specific behavior behind a driver boundary. A successful read from
one model does not establish protocol compatibility with another.

## Workflow

1. Identify the exact reader and module model, hardware revision, firmware,
   antenna, tag type, host interface, and regulatory region.
2. Read the primary documentation for that exact model. Treat nearby Chafon
   libraries and other model manuals as reference material, not proof.
3. Record confirmed wiring, electrical levels, serial settings, commands, byte
   formats, checksums, and test evidence in `docs/`, with source and date.
4. Keep raw frames and transport details in the model-specific driver. Expose
   validated, typed scan events to the application.
5. Test pure encoders/decoders with valid, malformed, truncated, and
   checksum-invalid frames. Keep hardware tests opt-in.

## Tag and inventory rules

- Treat EPC as a tag identifier, not a product description or proof of stock.
- Normalize and validate EPC values at system boundaries; retain the mapping
  history when tags are reassigned or replaced.
- A read is an observation. Do not derive current stock, sale, customer identity,
  or theft from an isolated read.
- Make repeated gateway delivery idempotent, and only acknowledge durable
  ingestion.
- Do not write, lock, or kill a tag unless the user explicitly requests that
  operation and confirms the exact target and irreversible consequences.
- Confirm local radio rules, antenna compatibility, power limits, and safe
  operating conditions before enabling a reader.

## In this repository

The current target devices have separate roles:

- **MU910-M:** planned UART-connected UHF module behind an ESP32 gateway.
- **CF-601:** planned USB desktop reader for tag enrollment and bench testing.
- **CF-RA9002:** candidate passive antenna; verify frequency range, connector,
  feedline, impedance, and power compatibility before RF transmission.

The supplied project details (MU910-M UART at 115200, CF-601 USB/COM, and
antenna connector claims) are requirements to verify against the exact hardware
revision and primary manuals, not yet tested support. A shared EPC Gen2 air
interface does not mean devices share a host protocol. Do not assume the MU60x
reference library implements MU910-M, CF-601, or CF-RU5102 commands.

Keep a separate driver and protocol test suite for each reader. Hardware support
remains unverified until tested on the exact device.
