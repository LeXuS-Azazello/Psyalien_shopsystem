---
name: retail-antitheft
description: Design a retail loss-prevention or anti-theft workflow that combines RFID observations with inventory operations and checkout evidence. Use for exit alerts, gates, tag deactivation, suspicious-event rules, or theft-related automation.
---

# Retail Loss Prevention

Design an auditable alert workflow, not an automated accusation. Sensors can
miss, duplicate, or misclassify events, so require corroboration and human review.

## Workflow

1. Map the actual process: receiving, tagging, shelf/stockroom zones, checkout,
   paid-item handling, exits, returns, and exception handling.
2. Identify authoritative evidence for each transition. Inventory changes come
   from confirmed operations; payment status comes from the POS or an explicitly
   defined operator action.
3. Model observations, inventory movements, sales, and alerts as distinct
   records. Keep timestamps, source, stable event IDs, and an audit trail.
4. Define an alert only from a documented rule that combines relevant zone
   evidence with checkout state and configured timing. Include uncertainty and
   allow a human to dismiss, investigate, or close it.
5. Test false positives and false negatives with staged, authorized scenarios:
   paid item, return, staff movement, tag read from an adjacent zone, duplicate
   event, missed read, and offline POS/gateway.
6. Use neutral UI language such as “unmatched exit observation”; never label a
   person a thief based only on an alert.

## Guardrails

- A tag read, RSSI value, CSI output, mmWave detection, or camera frame alone
  does not prove removal, payment status, identity, intent, or theft.
- Do not automatically confront, restrain, deny service to, or identify a person.
- Do not deactivate or permanently alter tags as a side effect of unrelated
  operations; require an explicit, confirmed workflow.
- Keep loss-prevention data access-controlled, minimally retained, and auditable.
- Send any Telegram alert as a neutral, minimal event summary; do not include a
  person's identity or phone number. Keep camera evidence local and access
  controlled by default.
- If the POS, zone layout, reader behavior, or local policy is unknown, ask
  before encoding alert rules.
