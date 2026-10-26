---
name: rf-915mhz
description: Evaluate a proposed 915 MHz radio design or diagnose regional band, antenna, module, or coexistence questions. Use whenever a project mentions 915 MHz, ISM-band operation, sub-GHz radios, or a 915 MHz RFID/LoRa module.
---

# 915 MHz Radio Planning

Frequency alone does not determine compatibility, legal use, or protocol.
Separate the radio band, modulation/protocol, device certification, antenna,
and jurisdiction.

## Workflow

1. Ask where the equipment will operate. Check current regulator and certification
   requirements for that country and device class before recommending operation.
2. Identify the exact module, supported channel range, antenna and gain,
   transmit power, bandwidth, duty/access rules, and firmware region setting.
3. Distinguish UHF RFID reader operation from LoRa/LoRaWAN and other sub-GHz
   links; they have different channelization, air interfaces, and coexistence
   behavior.
4. Check nearby radios and the actual antenna installation; test coexistence and
   performance in the target site rather than assuming the nominal band is clear.
5. Document the sources, jurisdiction, device, date, and unverified assumptions.
   Leave transmission disabled until the requirements are confirmed.

Never present a frequency allocation or power limit as universal legal advice.
