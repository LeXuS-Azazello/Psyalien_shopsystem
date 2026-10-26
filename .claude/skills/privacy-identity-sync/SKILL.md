---
name: privacy-identity-sync
description: Design customer-account identity, device synchronization, or deduplication without covert person tracking. Use when linking people or accounts across phones, RFID, CCTV, CSI/RuView, mmWave, gateways, or other shop devices.
---

# Privacy-Preserving Identity and Sync

Separate synchronization of devices and business events from identification of
people. A unique device ID is not a person ID, and a phone number is not a
reliable proof that one human has one account.

## Safe identity model

1. Define the product purpose and data controller before linking records. Ask
   which jurisdiction applies when legal requirements are relevant.
2. Give each gateway, reader, antenna, and camera its own device identifier.
   Synchronize device health and event IDs without using these IDs to create a
   hidden person profile.
3. For customer features, use an explicit account flow: explain the purpose,
   collect only necessary account data, verify a contact method when needed,
   and allow correction, unlinking, and deletion.
4. Treat phone numbers as personal contact/authentication data, not immutable
   global person identifiers. Numbers can be shared, recycled, mistyped, or
   unavailable. Do not silently search, enrich, or match contacts.
5. Use account-scoped, random internal IDs. Keep authentication credentials and
   contact details separate from purchase, sensor, and loss-prevention events.
   Hashing a phone number does not make cross-dataset linkage anonymous.
6. Define conflict handling, duplicate-account resolution, offline sync,
   idempotency, audit history, retention, and access controls. Do not merge
   accounts automatically based only on a matching name, phone, face, device, or
   sensor pattern.

## Cross-device limits

- Do not identify or deduplicate people by combining phone presence, MAC/device
  identifiers, CCTV/face, RFID reads, CSI/RuView, mmWave, location, gait, or
  behavioral signatures.
- Do not build persistent person-level profiles or infer that a person near a
  reader owns, carries, or stole a tagged item.
- Do not expose a customer's phone or identity in Telegram alerts or routine
  device telemetry.
- Keep RFID tag IDs mapped to products; keep device IDs mapped to hardware; keep
  customer account IDs in the explicit account domain. Do not collapse these
  namespaces.
- If the requested feature requires passive identification, covert tracking, or
  cross-modal person matching, stop and propose an opt-in, purpose-limited
  account workflow or aggregate analytics instead.

## Validation

Test shared/recycled phone scenarios, multiple devices per account, offline
updates, duplicate deliveries, opt-out, deletion, and failed verification.
Audit every authorized cross-domain linkage and avoid retaining temporary
matching data after its purpose is complete.
