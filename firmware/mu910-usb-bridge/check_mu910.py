#!/usr/bin/env python3
"""Send a non-RF MU910 GET_INFO request through the ESP32 USB bridge."""

import argparse
import collections
import sys
import time

import serial


def crc16(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0x8408 if crc & 1 else 0)
    return crc


def valid_frames(data: bytes) -> list[bytes]:
    frames = []
    for offset, byte in enumerate(data):
        if byte != 0xCF or offset + 7 > len(data):
            continue
        frame_length = data[offset + 4] + 7
        if data[offset + 4] < 1 or offset + frame_length > len(data):
            continue
        frame = data[offset : offset + frame_length]
        crc = crc16(frame[:-2])
        if frame[-2:] == bytes((crc >> 8, crc & 0xFF)):
            frames.append(frame)
    return frames


def build_request(command: int) -> bytes:
    frame = bytes((0xCF, 0xFF, command >> 8, command & 0xFF, 0))
    crc = crc16(frame)
    return frame + bytes((crc >> 8, crc & 0xFF))


def read_for(port: serial.Serial, duration: float) -> bytes:
    received = bytearray()
    deadline = time.monotonic() + duration
    while time.monotonic() < deadline:
        received.extend(port.read(256))
    return bytes(received)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="/dev/ttyACM0")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=1.0)
    args = parser.parse_args()

    requests = ((0x0051, "GET_INFO"), (0x0056, "GET_FRE"))
    try:
        with serial.Serial(args.port, args.baud, timeout=0.05, write_timeout=1) as port:
            port.reset_input_buffer()
            idle = read_for(port, 1.0)
            print(
                f"Idle RX/1s: {len(idle)} bytes; "
                f"common bytes: {collections.Counter(idle).most_common(6)}"
            )

            any_valid_response = False
            for command, name in requests:
                request = build_request(command)
                for attempt in range(1, args.attempts + 1):
                    port.reset_input_buffer()
                    port.write(request)
                    port.flush()
                    received = read_for(port, args.timeout)
                    frames = valid_frames(received)
                    matching = [
                        frame
                        for frame in frames
                        if int.from_bytes(frame[2:4], "big") == command
                    ]
                    any_valid_response |= bool(matching)
                    print(
                        f"{name} #{attempt}: RX={len(received)} bytes, "
                        f"valid matching frames={len(matching)}, "
                        f"exact echo={received.count(request)}"
                    )
                    if received:
                        print(f"  raw first 64 bytes: {received[:64].hex(' ')}")
                    for frame in matching:
                        print(f"  valid frame: {frame.hex(' ')}")
                        if command == 0x0056 and frame[5] == 0:
                            data = frame[6:-2]
                            if len(data) != 8:
                                print(
                                    "  GET_FRE payload length unexpected: "
                                    f"{len(data)} bytes"
                                )
                                continue
                            start = (
                                int.from_bytes(data[1:3], "big")
                                + int.from_bytes(data[3:5], "big") / 1000
                            )
                            step = int.from_bytes(data[5:7], "big") / 1000
                            channel_count = data[7]
                            if channel_count == 0:
                                print("  GET_FRE payload reports no channels")
                                continue
                            end = start + step * (channel_count - 1)
                            print(
                                f"  region=0x{data[0]:02X}, "
                                f"frequency={start:.3f}-{end:.3f} MHz, "
                                f"step={step:.3f} MHz, channels={channel_count}"
                            )

            return 0 if any_valid_response else 2
    except serial.SerialException as error:
        print(f"Serial error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
