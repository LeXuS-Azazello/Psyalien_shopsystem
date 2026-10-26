---
name: esp-now
description: Design or debug ESP-NOW links between ESP32 gateways, readers, and sensor nodes. Use when a task mentions ESP-NOW peers, datagrams, radio channels, encrypted links, delivery retries, or ESP32 device-to-device networking.
---

# ESP-NOW

Use ESP-NOW only as a bounded device-to-device transport. It is not an inventory
database, a substitute for server acknowledgements, or automatically a secure
or reliable delivery channel.

## Workflow

1. Confirm chip variants, ESP-IDF/Arduino versions, supported ESP-NOW features,
   Wi-Fi channel plan, peer count, payload format, and deployment region from
   the exact platform documentation.
2. Define a versioned, length-bounded message with message ID, sender identity,
   message type, and freshness information. Reject malformed or stale input.
3. Verify encryption and key provisioning for the actual SDK and peer setup.
   Never ship shared secrets in source, logs, or public examples.
4. Design acknowledgements, retry limits, duplicate suppression, and offline
   buffering explicitly. A radio callback is not proof that a database write
   succeeded.
5. Avoid blocking or heavy work in radio callbacks; hand validated payloads to
   a bounded queue and report queue overflow.
6. Test packet loss, duplicates, reordering, reboot, channel mismatch, and
   malformed frames. Do not claim delivery guarantees beyond measured results.

## Radio and deployment cautions

- Do not assume ESP-NOW and the store Wi-Fi access point can use different
  channels simultaneously on the same radio; verify the chip/SDK behavior.
- Do not conflate ESP-NOW with LoRa, LoRaWAN, or a routed IP network.
- Confirm permitted channels, transmit power, and duty/use restrictions for the
  deployment jurisdiction before field use.
