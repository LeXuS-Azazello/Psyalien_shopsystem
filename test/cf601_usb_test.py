import io
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch

from scripts.cf601_usb import FrameStream, TagRead, crc16, parse_args, parse_frame


class Cf601FrameTests(unittest.TestCase):
    def test_vendor_crc_reference(self):
        frame_data = bytes.fromhex(
            "CF0000011200FE4801000CE2806F120000000221506094"
        )
        self.assertEqual(crc16(frame_data), 0x7B78)

    def test_parse_reader_frame(self):
        frame = bytes.fromhex(
            "CF0100011200FC7C01000CE28068940000402C6FE3C0AE7BE0"
        )
        self.assertEqual(
            parse_frame(frame),
            TagRead(
                epc="E28068940000402C6FE3C0AE",
                antenna_id=1,
                rssi=-90.0,
            ),
        )

    def test_frame_stream_handles_usb_prefix_and_split_packets(self):
        frame = bytes.fromhex(
            "CF0100011200FC7C01000CE28068940000402C6FE3C0AE7BE0"
        )
        stream = FrameStream()
        first_reads, first_errors = stream.feed(b"\x00\x00" + frame[:9])
        second_reads, second_errors = stream.feed(frame[9:])
        self.assertEqual(first_reads, [])
        self.assertEqual(first_errors, [])
        self.assertEqual(second_errors, [])
        self.assertEqual(len(second_reads), 1)
        self.assertEqual(second_reads[0].epc, "E28068940000402C6FE3C0AE")

    def test_rejects_bad_crc(self):
        frame = bytearray.fromhex(
            "CF0100011200FC7C01000CE28068940000402C6FE3C0AE7BE0"
        )
        frame[-1] ^= 0x01
        with self.assertRaisesRegex(ValueError, "CRC mismatch"):
            parse_frame(bytes(frame))

    def test_rejects_inconsistent_epc_length(self):
        frame = bytearray.fromhex(
            "CF0100011200FC7C01000CE28068940000402C6FE3C0AE7BE0"
        )
        frame[10] = 0x0B
        checksum = crc16(frame[:-2])
        frame[-2:] = checksum.to_bytes(2, "big")
        with self.assertRaisesRegex(ValueError, "EPC length"):
            parse_frame(bytes(frame))

    def test_scan_duration_is_bounded(self):
        with patch("sys.argv", ["cf601_usb.py", "--duration", "61"]):
            with redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    parse_args()
        self.assertEqual(error.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
