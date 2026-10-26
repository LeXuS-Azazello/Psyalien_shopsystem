#!/usr/bin/env python3
"""Read Chafon CF-601 active-inventory frames from its CDC USB endpoint."""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

VID = 0x0483
PID = 0x5750
CDC_DATA_INTERFACE = 3
CDC_BULK_IN = 0x87
LIBUSB_ERROR_TIMEOUT = -7
MAX_SCAN_SECONDS = 60


@dataclass(frozen=True)
class TagRead:
    epc: str
    antenna_id: int | None
    rssi: float


def crc16(data: bytes) -> int:
    value = 0xFFFF
    for byte in data:
        value ^= byte
        for _ in range(8):
            value = (value >> 1) ^ 0x8408 if value & 1 else value >> 1
    return value


def parse_frame(frame: bytes) -> TagRead | None:
    if len(frame) < 7 or frame[0] != 0xCF:
        raise ValueError("not a complete CF-601 frame")

    payload_length = frame[4]
    expected_length = 7 + payload_length
    if len(frame) != expected_length:
        raise ValueError("CF-601 frame length does not match its header")

    expected_crc = int.from_bytes(frame[-2:], "big")
    if crc16(frame[:-2]) != expected_crc:
        raise ValueError("CF-601 frame CRC mismatch")

    command = int.from_bytes(frame[2:4], "big")
    if command != 0x0001:
        return None

    payload = frame[5:-2]
    if len(payload) < 6:
        raise ValueError("CF-601 inventory payload is truncated")
    if payload[0] != 0:
        raise ValueError(f"CF-601 reported inventory status 0x{payload[0]:02X}")

    epc_length = payload[5]
    if len(payload) != 6 + epc_length:
        raise ValueError("CF-601 EPC length does not match its payload")
    if epc_length < 2:
        raise ValueError("CF-601 EPC is too short")

    antenna_mask = payload[3]
    antenna_id = (
        antenna_mask.bit_length()
        if antenna_mask > 0 and antenna_mask & (antenna_mask - 1) == 0
        else None
    )
    rssi = int.from_bytes(payload[1:3], "big", signed=True) / 10
    return TagRead(
        epc=payload[6:].hex().upper(),
        antenna_id=antenna_id,
        rssi=rssi,
    )


class FrameStream:
    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, data: bytes) -> tuple[list[TagRead], list[str]]:
        self._buffer.extend(data)
        reads: list[TagRead] = []
        errors: list[str] = []

        while True:
            start = self._buffer.find(0xCF)
            if start < 0:
                self._buffer.clear()
                break
            if start:
                del self._buffer[:start]
            if len(self._buffer) < 5:
                break

            frame_length = 7 + self._buffer[4]
            if len(self._buffer) < frame_length:
                break

            frame = bytes(self._buffer[:frame_length])
            try:
                read = parse_frame(frame)
            except ValueError as error:
                errors.append(str(error))
                del self._buffer[0]
                continue

            del self._buffer[:frame_length]
            if read is not None:
                reads.append(read)

        return reads, errors


class DevicePara(ctypes.Structure):
    _fields_ = [
        (name, ctypes.c_ubyte)
        for name in (
            "DEVICEARRD",
            "RFIDPRO",
            "WORKMODE",
            "INTERFACE",
            "BAUDRATE",
            "WGSET",
            "ANT",
            "REGION",
            "STRATFREI_0",
            "STRATFREI_1",
            "STRATFRED_0",
            "STRATFRED_1",
            "STEPFRE_0",
            "STEPFRE_1",
            "CN",
            "RFIDPOWER",
            "INVENTORYAREA",
            "QVALUE",
            "SESSION",
            "ACSADDR",
            "ACSDATALEN",
            "FILTERTIME",
            "TRIGGLETIME",
            "BUZZERTIME",
            "INTENERLTIME",
        )
    ]


def default_sdk_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "UHF Desk Reader SDK"
        / "Sample"
        / "Linux_QT"
        / "Release"
        / "libCFApi.so"
    )


def _hid_interface_number(path: str) -> int | None:
    match = re.fullmatch(r"/dev/hidraw\d+", path)
    if not match:
        return None

    device_path = Path("/sys/class/hidraw") / Path(path).name / "device"
    resolved = device_path.resolve(strict=False)
    for parent in (resolved, *resolved.parents):
        interface_file = parent / "bInterfaceNumber"
        if interface_file.is_file():
            return int(interface_file.read_text(encoding="ascii").strip(), 16)
    return None


class VendorSdk:
    def __init__(self, library_path: Path) -> None:
        if not library_path.is_file():
            raise RuntimeError(f"CF-601 SDK library not found: {library_path}")

        hid_library = library_path.with_name("libhid.so")
        if not hid_library.is_file():
            raise RuntimeError(f"CF-601 SDK dependency not found: {hid_library}")
        try:
            self._hid = ctypes.CDLL(str(hid_library), mode=ctypes.RTLD_GLOBAL)
        except OSError as error:
            raise RuntimeError(f"Could not load CF-601 HID library: {error}") from error
        self.api = ctypes.CDLL(str(library_path))
        self.api.CFHid_GetUsbCount.argtypes = []
        self.api.CFHid_GetUsbCount.restype = ctypes.c_int
        self.api.CFHid_GetUsbInfo.argtypes = [ctypes.c_ushort, ctypes.c_char_p]
        self.api.CFHid_GetUsbInfo.restype = ctypes.c_int
        self.api.OpenHidConnection.argtypes = [
            ctypes.POINTER(ctypes.c_longlong),
            ctypes.c_ushort,
        ]
        self.api.OpenHidConnection.restype = ctypes.c_int
        self.api.GetDevicePara.argtypes = [
            ctypes.c_longlong,
            ctypes.POINTER(DevicePara),
        ]
        self.api.GetDevicePara.restype = ctypes.c_int
        self.api.InventoryStop.argtypes = [ctypes.c_longlong, ctypes.c_ushort]
        self.api.InventoryStop.restype = ctypes.c_int
        self.api.CloseDevice.argtypes = [ctypes.c_longlong]
        self.api.CloseDevice.restype = ctypes.c_int

    def _open_control_interface(self) -> ctypes.c_longlong:
        count = self.api.CFHid_GetUsbCount()
        if count <= 0:
            raise RuntimeError(f"CFHid_GetUsbCount returned {count}")

        indexes: list[int] = []
        for index in range(count):
            info = ctypes.create_string_buffer(256)
            result = self.api.CFHid_GetUsbInfo(index, info)
            if result != 1:
                raise RuntimeError(f"CFHid_GetUsbInfo({index}) returned {result}")
            path = info.value.decode("utf-8", errors="replace")
            if _hid_interface_number(path) == 0:
                indexes.append(index)

        if len(indexes) != 1:
            raise RuntimeError(
                "Could not identify exactly one CF-601 control HID interface "
                "in sysfs"
            )

        handle = ctypes.c_longlong(0)
        result = self.api.OpenHidConnection(ctypes.byref(handle), indexes[0])
        if result != 0:
            raise RuntimeError(f"OpenHidConnection returned {result}")
        return handle

    def read_parameters(self) -> DevicePara:
        handle = self._open_control_interface()
        try:
            params = DevicePara()
            result = self.api.GetDevicePara(handle.value, ctypes.byref(params))
            if result != 0:
                raise RuntimeError(f"GetDevicePara returned {result}")
            return params
        finally:
            result = self.api.CloseDevice(handle.value)
            if result != 0:
                print(f"CloseDevice returned {result}", file=sys.stderr)

    def stop_inventory(self) -> None:
        handle = self._open_control_interface()
        try:
            result = self.api.InventoryStop(handle.value, 10_000)
            if result != 0:
                raise RuntimeError(f"InventoryStop returned {result}")
        finally:
            close_result = self.api.CloseDevice(handle.value)
            if close_result != 0:
                print(f"CloseDevice returned {close_result}", file=sys.stderr)


def run_sdk_helper(library_path: Path, action: str) -> dict[str, int] | None:
    helper = Path(__file__).with_name("cf601_sdk_helper.py")
    env = os.environ.copy()
    library_dir = str(library_path.parent)
    existing_library_path = env.get("LD_LIBRARY_PATH")
    env["LD_LIBRARY_PATH"] = (
        f"{library_dir}:{existing_library_path}"
        if existing_library_path
        else library_dir
    )
    result = subprocess.run(
        [
            sys.executable,
            str(helper),
            action,
            "--sdk-library",
            str(library_path),
        ],
        capture_output=True,
        check=False,
        env=env,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(
            f"CF-601 SDK {action} helper failed: {detail or result.returncode}"
        )
    if action == "read":
        value = json.loads(result.stdout)
        if not isinstance(value, dict) or not all(
            isinstance(item, int) for item in value.values()
        ):
            raise RuntimeError("CF-601 SDK helper returned invalid device settings")
        return value
    return None


class Libusb:
    def __init__(self) -> None:
        try:
            self.api = ctypes.CDLL("libusb-1.0.so.0")
        except OSError as error:
            raise RuntimeError(f"Could not load libusb-1.0: {error}") from error

        self.context = ctypes.c_void_p()
        self.handle = ctypes.c_void_p()
        self.claimed = False
        self.api.libusb_init.argtypes = [ctypes.POINTER(ctypes.c_void_p)]
        self.api.libusb_init.restype = ctypes.c_int
        self.api.libusb_open_device_with_vid_pid.argtypes = [
            ctypes.c_void_p,
            ctypes.c_ushort,
            ctypes.c_ushort,
        ]
        self.api.libusb_open_device_with_vid_pid.restype = ctypes.c_void_p
        self.api.libusb_kernel_driver_active.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int,
        ]
        self.api.libusb_kernel_driver_active.restype = ctypes.c_int
        self.api.libusb_claim_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.api.libusb_claim_interface.restype = ctypes.c_int
        self.api.libusb_bulk_transfer.argtypes = [
            ctypes.c_void_p,
            ctypes.c_ubyte,
            ctypes.POINTER(ctypes.c_ubyte),
            ctypes.c_int,
            ctypes.POINTER(ctypes.c_int),
            ctypes.c_uint,
        ]
        self.api.libusb_bulk_transfer.restype = ctypes.c_int
        self.api.libusb_release_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.api.libusb_release_interface.restype = ctypes.c_int
        self.api.libusb_close.argtypes = [ctypes.c_void_p]
        self.api.libusb_exit.argtypes = [ctypes.c_void_p]

        result = self.api.libusb_init(ctypes.byref(self.context))
        if result != 0:
            raise RuntimeError(f"libusb_init returned {result}")
        self.handle = self.api.libusb_open_device_with_vid_pid(
            self.context, VID, PID
        )
        if not self.handle:
            self.api.libusb_exit(self.context)
            self.context = ctypes.c_void_p()
            raise RuntimeError(
                f"Could not open USB device {VID:04X}:{PID:04X}; "
                "check USB permissions"
            )

        driver = self.api.libusb_kernel_driver_active(
            self.handle, CDC_DATA_INTERFACE
        )
        if driver == 1:
            self.close()
            raise RuntimeError(
                "A kernel driver is attached to CDC data interface 3; "
                "refusing to detach it"
            )
        if driver < 0 and driver != -12:
            self.close()
            raise RuntimeError(f"libusb kernel-driver query returned {driver}")

        result = self.api.libusb_claim_interface(self.handle, CDC_DATA_INTERFACE)
        if result != 0:
            self.close()
            raise RuntimeError(f"Could not claim CDC data interface: {result}")
        self.claimed = True

    def read(self, timeout_ms: int = 250) -> bytes:
        buffer = (ctypes.c_ubyte * 64)()
        transferred = ctypes.c_int(0)
        result = self.api.libusb_bulk_transfer(
            self.handle,
            CDC_BULK_IN,
            buffer,
            len(buffer),
            ctypes.byref(transferred),
            timeout_ms,
        )
        if result == LIBUSB_ERROR_TIMEOUT and transferred.value == 0:
            return b""
        if result not in (0, LIBUSB_ERROR_TIMEOUT):
            raise RuntimeError(f"libusb bulk transfer returned {result}")
        return bytes(buffer[: transferred.value])

    def close(self) -> None:
        if self.handle:
            if self.claimed:
                result = self.api.libusb_release_interface(
                    self.handle, CDC_DATA_INTERFACE
                )
                self.claimed = False
                if result != 0:
                    print(
                        f"libusb_release_interface returned {result}",
                        file=sys.stderr,
                    )
            self.api.libusb_close(self.handle)
            self.handle = ctypes.c_void_p()
        if self.context:
            self.api.libusb_exit(self.context)
            self.context = ctypes.c_void_p()


def post_event(api_url: str, token: str | None, event: dict[str, object]) -> str:
    request = urllib.request.Request(
        api_url,
        data=json.dumps(event).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Scan API returned HTTP {error.code}: {details}"
        ) from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not reach scan API: {error.reason}") from error

    status = result.get("data", {}).get("status") if isinstance(result, dict) else None
    if status not in ("accepted", "duplicate"):
        raise RuntimeError(f"Scan API returned an unexpected response: {result!r}")
    return str(status)


def emit_read(
    read: TagRead,
    reader_id: str,
    api_url: str | None,
    api_token: str | None,
) -> None:
    event: dict[str, object] = {
        "eventId": str(uuid.uuid4()),
        "epc": read.epc,
        "readerId": reader_id,
        "observedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "rssi": read.rssi,
    }
    if read.antenna_id is not None:
        event["antennaId"] = read.antenna_id

    if api_url:
        status = post_event(api_url, api_token, event)
        print(f"{status}: EPC {read.epc}", file=sys.stderr, flush=True)
    else:
        print(json.dumps(event, separators=(",", ":")), flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read CF-601 CDC frames for a bounded interval, then stop inventory."
        )
    )
    parser.add_argument("--duration", type=float, default=5.0)
    parser.add_argument("--reader-id", default="cf601-cf000701")
    parser.add_argument(
        "--api-url",
        help="POST scan events here; without this option JSON events go to stdout",
    )
    parser.add_argument("--api-token", default=os.environ.get("API_TOKEN"))
    parser.add_argument("--dedupe-ms", type=int, default=1000)
    parser.add_argument(
        "--sdk-library",
        type=Path,
        default=Path(os.environ["CF601_SDK_LIBRARY"])
        if os.environ.get("CF601_SDK_LIBRARY")
        else default_sdk_path(),
    )
    args = parser.parse_args()
    if args.duration <= 0:
        parser.error("--duration must be greater than zero")
    if args.duration > MAX_SCAN_SECONDS:
        parser.error(f"--duration cannot exceed {MAX_SCAN_SECONDS} seconds")
    if args.dedupe_ms < 0:
        parser.error("--dedupe-ms cannot be negative")
    if not args.reader_id.strip() or len(args.reader_id) > 140:
        parser.error("--reader-id must contain 1 to 140 characters")
    if args.api_url:
        parsed = urlparse(args.api_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            parser.error("--api-url must be an absolute HTTP or HTTPS URL")
    return args


def main() -> int:
    args = parse_args()
    params = run_sdk_helper(args.sdk_library, "read")
    if params is None:
        raise RuntimeError("CF-601 SDK did not return device settings")
    print(
        "CF-601 settings: "
        f"WORKMODE={params['WORKMODE']}, INTERFACE=0x{params['INTERFACE']:02X}, "
        f"REGION=0x{params['REGION']:02X}, POWER={params['RFIDPOWER']} dBm, "
        f"BUZZERTIME={params['BUZZERTIME']}",
        file=sys.stderr,
        flush=True,
    )
    if params["INTERFACE"] != 0x04 or params["WORKMODE"] != 1:
        raise RuntimeError(
            "This reader must already be configured for CDC_COM and Active Mode; "
            "this tool never changes device settings"
        )
    if params["BUZZERTIME"]:
        print(
            "Buzzer is enabled; repeated beeps during inventory are expected.",
            file=sys.stderr,
            flush=True,
        )

    usb: Libusb | None = None
    try:
        usb = Libusb()
        decoder = FrameStream()
        last_seen: dict[str, float] = {}
        deadline = time.monotonic() + args.duration
        while time.monotonic() < deadline:
            packet = usb.read()
            if not packet:
                continue
            reads, errors = decoder.feed(packet)
            for error in errors:
                print(f"Discarding invalid CF-601 frame: {error}", file=sys.stderr)
            for read in reads:
                now = time.monotonic()
                if now - last_seen.get(read.epc, float("-inf")) < (
                    args.dedupe_ms / 1000
                ):
                    continue
                last_seen[read.epc] = now
                emit_read(read, args.reader_id, args.api_url, args.api_token)
    finally:
        if usb is not None:
            usb.close()
        run_sdk_helper(args.sdk_library, "stop")
        print("CF-601 inventory stopped.", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"CF-601 scan failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
