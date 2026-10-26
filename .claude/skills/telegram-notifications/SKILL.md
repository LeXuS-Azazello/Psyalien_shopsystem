---
name: telegram-notifications
description: Implement Telegram bot notifications for ShopSystem operational errors and store alerts, including delivery retries, chat authorization, and privacy-safe anti-theft notifications. Use whenever Telegram, bot alerts, error reporting, store events, or camera snapshots sent to Telegram are requested.
---

# Telegram Notifications

Use Telegram as an external notification channel, not as the system of record.
Bot chats are cloud-based; send only information that is appropriate to share
with that third-party service.

## Workflow

1. Clarify which errors and business events need notification, their severity,
   recipient chats, expected volume, and who may view them.
2. Keep bot tokens in machine-local secret configuration. Never commit tokens,
   print them, include them in URLs/logs, or expose them to browser clients.
3. Allowlist configured chat IDs. Do not let a request parameter or untrusted
   event choose a notification recipient.
4. Normalize messages into a bounded schema: event ID, time, severity, subsystem,
   neutral summary, and a minimal reference to the event in the local system.
   Redact credentials, tokens, RTSP URLs, phone numbers, customer data, raw tag
   payloads, and stack traces that may contain secrets.
5. Use bounded queues, rate limiting, retry/backoff for transient failures, and
   deduplication/grouping for repeated errors. Do not let notification failure
   recursively generate more notifications; retain an explicit local error
   signal and expose delivery health.
6. Distinguish operational errors from store alerts. Use neutral wording such
   as “unmatched exit observation”; include the rule and evidence summary, not
   an accusation or inferred identity.
7. Test successful delivery, unauthorized chats, API errors, timeouts, rate
   limits, duplicate events, queue overflow, token redaction, and shutdown.
   Use a mocked Bot API in automated tests.

## Error notification design

- Capture errors at application boundaries and classify them. Do not promise
  that every process failure can be delivered while the process or network is
  down; keep local logs/health as the fallback.
- Report enough context to diagnose the subsystem and correlate a sanitized
  event ID. Send stack traces only to a separately secured diagnostic sink.
- Avoid flooding operators: group repeated errors and send recovery notices
  where useful.
- Treat Telegram's send result as notification delivery only, not durable
  business-event storage or operator acknowledgement.

## Store alerts and camera evidence

- A loss-prevention alert must come from a documented rule that checks relevant
  exit-zone observations and authoritative checkout/POS state. Sensor reads
  alone do not prove theft, payment status, identity, or intent.
- Do not include a person's name, phone number, face, or cross-sensor profile in
  an alert. Keep the message minimal and link to an access-controlled local
  incident record for authorized review.
- Do not upload camera snapshots or clips to Telegram by default. Prefer a
  short-lived, authenticated local-view link. If the operator explicitly enables
  image delivery, first verify applicable notice, legal basis, authorized
  recipients, retention/deletion, and camera access; restrict it to the
  configured camera and event window, minimize the frame, and disable facial
  recognition or person identification.
- Make snapshot delivery opt-in, auditable, size-bounded, and separately
  configurable from error alerts. Never silently fall back to sending a frame
  when local viewing fails.
- Require human review; do not trigger confrontation, denial of service, or
  automatic action against a person from a Telegram alert.

## Suggested separation

Keep notification formatting, transport, and event policy separate:

- application events produce typed operational/error or store-alert records;
- a notifier applies recipient, redaction, grouping, and rate policies;
- a Telegram adapter performs Bot API delivery and reports delivery failures;
- inventory, POS, and incident records remain in the local system of record.
