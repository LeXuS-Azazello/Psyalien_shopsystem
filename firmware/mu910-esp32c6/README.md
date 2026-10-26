# MU910-M firmware for ESP32-S3

ESP-IDF firmware for the Chafon MU910-M module (`CF000749`, reported
hardware/firmware revision `v1.3`) on the reported ESP32-S3-N8R2 module
(8 MB flash, 2 MB PSRAM) on a JXINW solderable ESP32-S3 development board
(exact board revision/pinout not verified).
This is a separate firmware project; the ShopSystem Node.js process does not
run on the ESP32. The firmware does not currently require PSRAM.

## UART wiring

The configured UART is UART1 at 115200 8N1:

| MU910-M signal | ESP32-S3 signal |
| --- | --- |
| TXD | GPIO11 (UART RX) |
| RXD | GPIO10 (UART TX) |
| GND | GND |

GPIO11 and GPIO10 are the currently configured pins. Confirm their labels
against the exact carrier-board revision and the MU910-M v1.3 connector before
wiring. Do not confuse connector pin numbers with ESP32 GPIO numbers. Both
devices must share ground.

The carrier board also exposes an `EN` input. The module requires this pin to
be held high at 3.3 V to operate. The supplied board photo appears to show EN
unconnected; verify it and, with power off, connect EN to the ESP32 board's
3V3 output. Do not connect EN to 5 V.

The owner reports powering the module from a separate 5 V supply, with a
common ground to the ESP32. Earlier measurement at the module showed 1.6 V
before this change; the owner later confirmed approximately 5 V at VCC/GND.
The supply's available current has not been independently verified.

## RF safety gate

RF inventory is **disabled by default**. The first firmware build only sends
the non-RF `GET_INFO` command and verifies a valid response before doing
anything else.

Do not enable inventory until the exact CF-RA9002 frequency variant, the
antenna/feedline/connector match, and permitted frequency and RF power for the
installation in Thailand are confirmed. The owner now confirms the
CF-RA9002-new antenna variant is 902–928 MHz, with 9 dBi gain and VSWR <= 1.3.
The MU91X V1.3 manual lists a US module band of 902.75–927.25 MHz, but does not
list Thailand as a region. This overlap does not establish that the installed
MU910-M is the matching hardware variant, that its current frequency settings
are appropriate, or that operation is permitted in Thailand. The product
listing states an N-female antenna connector and a default
TNC-male cable connector; confirm the actual cable and mating connector chain.
The MU910-M has an MMCX-female antenna socket, so use only a verified 50-ohm
feedline with correctly mating connectors.

After confirming those items, enable `MU910-M Reader -> Enable RF inventory`
in `idf.py menuconfig`. Inventory uses a bounded time-limited burst followed by
a cooldown; this project does not set RF power, frequency, or other persistent
reader settings.

## Build and flash

Use the ESP-IDF installation already configured on the host:

```sh
cd firmware/mu910-esp32c6
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
```

Select the actual serial port shown by the operating system. The firmware
is configured for 8 MB flash; the N8R2 module's 2 MB PSRAM is not enabled or
used. It prints module identification status and any valid tag reads at 115200
baud on the ESP32 console. A tag line is diagnostic output, not yet the backend
scan event contract; Wi-Fi/MQTT forwarding is a separate integration step.

UART GPIOs are currently ESP32-S3 TX=GPIO17 and RX=GPIO18 and can be changed in
`idf.py menuconfig` to match the actual carrier board.

## Protocol source

The frame format, command IDs, CRC16, inventory response, and EPC fields are
implemented from the Chafon-provided `UHF Senior Module User guide V1.2.docx`
and `MU91X_UHF电子标签读写器用户手册-V1.3.docx` included in
`UHF+Senior+Module/UHF Senior Module/User Guide/`. The separate one-page
`MU910-M.pdf` is a pin/specification sheet and does not document the UART
command protocol. Do not substitute the unrelated MU60x, CF-601, or CF-RU5102
host protocol.

## Host-side protocol tests

From this directory:

```sh
cc -std=c11 -Wall -Wextra -Werror \
  test/test_mu910_protocol.c main/mu910_protocol.c \
  -o /tmp/test-mu910-protocol
/tmp/test-mu910-protocol
```
