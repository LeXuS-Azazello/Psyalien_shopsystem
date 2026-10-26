# MU910 USB Serial/JTAG bridge

This temporary ESP32-S3 firmware forwards bytes bidirectionally between the
native USB Serial/JTAG port and UART1 at 115200 8N1. The default wiring is:

- ESP32 GPIO10 TX -> MU910 RXD
- ESP32 GPIO11 RX <- MU910 TXD
- ESP32 GND <-> MU910 GND

It sends no reader commands on its own. The vendor Linux SDK can open the
ESP32's `/dev/ttyACM*` device as a serial port and communicate with the reader
through this bridge. Use the Linux Qt sample to open the reader and read its
settings first; do not start inventory or change RF settings until the reader's
frequency region and antenna/cable configuration are confirmed.

The normal firmware in `../mu910-esp32c6` is not modified by this project.
Reflash that project to return to the diagnostic firmware.
