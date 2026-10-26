---
name: lora-radio
description: Design or troubleshoot LoRa or LoRaWAN links for store sensors and ESP32 gateways. Use when a task mentions LoRa, LoRaWAN, long-range low-power radio, regional channel plans, gateways, or 915 MHz sub-GHz links.
---

# LoRa and LoRaWAN

First distinguish LoRa modulation from LoRaWAN networking. A point-to-point
LoRa link and a LoRaWAN device have different addressing, security, network
server, and gateway requirements.

## Workflow

1. Confirm the country/region, exact radio module, antenna, chipset, firmware,
   network architecture, payload frequency, and power source.
2. Consult current official radio regulations and the selected module's
   regional configuration. Do not copy a frequency plan, power, duty cycle,
   bandwidth, or data rate from another country or module.
3. For LoRaWAN, use the correct regional parameters and an authorized network
   server; provision device credentials securely and avoid hardcoded keys.
4. Define compact, versioned payloads with integrity checks and freshness.
   Assume constrained bandwidth, loss, delay, and duplicate delivery.
5. Keep radio events separate from the inventory system until authenticated,
   validated, and durably stored. Use idempotent event IDs and explicit
   acknowledgements only where the selected stack supports them.
6. Measure link margin, packet loss, latency, airtime, battery use, and
   interference at the installation site. Mark simulation separately from
   field evidence.

## Do not conflate

- 915 MHz is not a globally valid default and does not by itself identify a
  protocol or authorize transmission.
- LoRa/LoRaWAN is not UHF RFID and cannot read EPC tags.
- Do not place personal, customer, or CCTV data in radio payloads when a
  pseudonymous event reference is sufficient.
