---
name: privacy-sensor-data
description: Review or implement privacy protections for RFID, CSI/RuView, mmWave, CCTV, LoRa, or other shop sensor data. Use when collecting, linking, retaining, exporting, or analyzing sensor observations or person-related data.
---

# Privacy for Sensor Data

Apply privacy safeguards before collection and keep them aligned with the
specific purpose. Sensor data that lacks a name may still be linkable to a
person, device, location, or routine.

## Review checklist

1. State the purpose and demonstrate why each data field and sensor is needed.
   Prefer aggregate counts or short-lived event references over raw data.
2. Classify each source separately: EPC/read events, ESP32 telemetry, CSI/RuView,
   mmWave, CCTV/RTSP, POS, and operational logs.
3. Keep identity, payment, video, and RF sensing data in separate stores or
   access boundaries unless an approved workflow requires a narrowly scoped
   join. For Telegram notifications, treat the bot service as a third party and
   send a minimal event reference rather than a person profile, phone number,
   or raw sensor/video data.
4. Define notice/consent or other applicable legal basis, permitted users,
   retention period, deletion/export process, and incident handling before
   enabling collection. Ask for jurisdiction when it affects requirements.
5. Minimize precision and retention; restrict access; protect secrets and
   backups; audit sensitive reads and exports; redact logs.
6. Test that disabled integrations do not collect data and that deletion,
   expiration, and access controls work as intended.

## Sensing limits

- Do not infer personal identity, intent, health, or wrongdoing from RFID, CSI,
  mmWave, or other indirect measurements.
- Do not combine modalities into persistent person-level tracking by default.
- Do not deduplicate people across devices using phone presence, camera/face,
  RFID, CSI/RuView, mmWave, or behavioral patterns. Use explicit, verified,
  account-scoped customer flows where needed; phone numbers are not immutable
  person identifiers.
- Treat video, biometrics, precise location, and behavioral or health inferences
  as particularly sensitive.
- Report uncertainty, purpose limits, and known error rates to operators; do not
  present model output as ground truth.
