---
name: mmwave-sensing
description: Integrate or evaluate mmWave/FMCW radar sensors such as presence or distance modules with ESP32 gateways and the shop system. Use when discussing mmWave, FMCW, radar presence, sensor fusion, or related hardware.
---

# mmWave Sensing

Treat each radar module as a distinct sensor with its own data contract,
capabilities, and regulatory requirements.

## Workflow

1. Confirm the exact module, carrier board, firmware, frequency band, interface,
   output format, field of view, mounting, and intended environment from primary
   documentation.
2. Establish what the module actually reports: for example, presence, range,
   motion, or other derived measurements. Do not infer capabilities from another
   model's documentation.
3. Check radio authorization and local requirements before enabling transmission
   or deploying the module.
4. Keep raw sensor frames in a dedicated adapter; validate units, ranges,
   timestamps, and version before producing normalized events.
5. Use simulation or consented test data first; then measure false positives,
   false negatives, cross-zone effects, and calibration stability in the actual
   installation.
6. Keep optional sensing disabled by default and document retention and access
   controls for any stored measurements.

## Limits

- Presence or motion is not identity, intent, theft, or proof of merchandise
  movement.
- Do not use a radar output as a medical diagnosis or claim vital-sign accuracy
  without validated evidence and an appropriate use case.
- Do not fuse mmWave, CSI, or CCTV into a person-level profile by default.
- Report simulated, vendor-claimed, and measured performance distinctly.
