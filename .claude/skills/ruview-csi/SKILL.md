---
name: ruview-csi
description: Integrate or evaluate RuView/Wi-Fi CSI sensing for this shop system, including ESP32 CSI nodes, occupancy signals, and sensor-event adapters. Use whenever RuView, CSI, Wi-Fi sensing, or RF-based presence/activity analysis is discussed.
---

# RuView and Wi-Fi CSI

Treat CSI as an experimental, opt-in sensing source. It can provide signal
measurements or model outputs; it does not identify an RFID tag, establish a
person's identity, or prove a retail event.

## Workflow

1. Establish the intended use, sensor placement, source device, firmware,
   software version, data fields, and privacy review before collecting data.
2. When the RuView checkout is available, read its current `CLAUDE.md`,
   applicable scoped instructions, source, tests, and the relevant skill under
   `plugins/ruview/skills/`. Relevant RuView skills include hardware setup,
   applications, configuration, advanced sensing, and verification. Treat
   their claims as project-specific and verify against current source.
3. Keep the integration behind an adapter and disabled by default. Store sensor
   observations separately from products, EPCs, customers, and transactions.
4. Validate timestamps, node IDs, payload sizes, and schema versions; use
   bounded queues and explicit error reporting.
5. Label performance and accuracy statements as measured with a reproducer,
   claimed, or synthetic. A build, simulation, or demo is not live-hardware
   evidence.
6. Test on synthetic or consented data first. Report limitations, calibration
   drift, false positives/negatives, and environmental sensitivity.

## Boundaries

- Do not infer RFID identity, customer identity, intent, or theft from CSI.
- Do not enable through-wall or person-level tracking for shop operations without
  explicit authorization, privacy review, and a narrowly defined purpose.
- Prefer aggregate occupancy or equipment-health outputs when sufficient.
- Keep raw CSI and person-related outputs out of routine logs and source control.
