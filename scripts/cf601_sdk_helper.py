#!/usr/bin/env python3
"""Isolated subprocess for Chafon's SDK, which needs its bundled libhid.so."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cf601_usb import VendorSdk, default_sdk_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("read", "stop"))
    parser.add_argument("--sdk-library", type=Path, default=default_sdk_path())
    args = parser.parse_args()

    sdk = VendorSdk(args.sdk_library)
    if args.action == "stop":
        sdk.stop_inventory()
        return 0

    params = sdk.read_parameters()
    print(
        json.dumps(
            {
                "WORKMODE": params.WORKMODE,
                "INTERFACE": params.INTERFACE,
                "REGION": params.REGION,
                "RFIDPOWER": params.RFIDPOWER,
                "BUZZERTIME": params.BUZZERTIME,
            }
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"CF-601 SDK helper failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
