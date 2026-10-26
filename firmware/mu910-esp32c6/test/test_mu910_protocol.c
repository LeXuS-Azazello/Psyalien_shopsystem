#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "../main/mu910_protocol.h"

static unsigned response_count;
static mu910_response_t last_response;
static uint8_t last_response_data[MU910_MAX_FRAME_SIZE];

static void capture_response(const mu910_response_t *response, void *context) {
  (void)context;
  response_count++;
  last_response = *response;
  assert(response->data_length <= sizeof(last_response_data));
  memcpy(last_response_data, response->data, response->data_length);
  last_response.data = last_response_data;
}

static size_t make_response(uint8_t *frame, uint16_t command, uint8_t status,
                            const uint8_t *data, size_t data_length) {
  const size_t length = data_length + 1;
  frame[0] = 0xCF;
  frame[1] = 0x00;
  frame[2] = (uint8_t)(command >> 8);
  frame[3] = (uint8_t)command;
  frame[4] = (uint8_t)length;
  frame[5] = status;
  if (data_length > 0) {
    memcpy(&frame[6], data, data_length);
  }
  const size_t frame_length = length + 7;
  const uint16_t crc = mu910_crc16(frame, frame_length - 2);
  frame[frame_length - 2] = (uint8_t)(crc >> 8);
  frame[frame_length - 1] = (uint8_t)crc;
  return frame_length;
}

static void test_crc_reference_vector(void) {
  static const uint8_t input[] = "123456789";
  assert(mu910_crc16(input, sizeof(input) - 1) == 0x6F91);
}

static void test_command_frames(void) {
  uint8_t frame[MU910_MAX_FRAME_SIZE];
  assert(mu910_build_module_init(frame, sizeof(frame)) == 7);
  assert(memcmp(frame, (uint8_t[]){0xCF, 0xFF, 0x00, 0x50, 0x00}, 5) == 0);
  const uint16_t init_crc = mu910_crc16(frame, 5);
  assert(frame[5] == (uint8_t)(init_crc >> 8));
  assert(frame[6] == (uint8_t)init_crc);

  assert(mu910_build_get_info(frame, sizeof(frame)) == 7);
  assert(memcmp(frame, (uint8_t[]){0xCF, 0xFF, 0x00, 0x51, 0x00, 0x1E, 0xFE},
                7) == 0);

  assert(mu910_build_inventory(5, frame, sizeof(frame)) == 12);
  assert(memcmp(frame,
                (uint8_t[]){0xCF, 0xFF, 0x00, 0x01, 0x05, 0x00, 0x00,
                            0x00, 0x00, 0x05, 0xA2, 0x18},
                12) == 0);

  assert(mu910_build_inventory(5, frame, 11) == 0);
  assert(mu910_build_command(0xFF, 1, NULL, 1, frame, sizeof(frame)) == 0);
}

static void test_stream_parser_and_tag_payload(void) {
  static const uint8_t tag_data[] = {
      0xFE, 0x0C, 0x01, 0x02, 0x04, 0xE2, 0x80, 0x68, 0x94,
  };
  uint8_t frame[MU910_MAX_FRAME_SIZE];
  const size_t frame_length =
      make_response(frame, 0x0001, 0x00, tag_data, sizeof(tag_data));

  mu910_parser_t parser;
  mu910_parser_init(&parser);
  response_count = 0;
  mu910_parser_feed(&parser, (uint8_t[]){0x00, 0x55, 0xCF}, 3,
                    capture_response, NULL);
  mu910_parser_feed(&parser, frame + 1, 3, capture_response, NULL);
  mu910_parser_feed(&parser, frame + 4, frame_length - 4, capture_response,
                    NULL);

  assert(response_count == 1);
  assert(last_response.address == 0x00);
  assert(last_response.command == 0x0001);
  assert(last_response.status == 0x00);

  mu910_inventory_tag_t tag;
  assert(mu910_parse_inventory_tag(&last_response, &tag));
  assert(tag.epc_length == 4);
  assert(memcmp(tag.epc, (uint8_t[]){0xE2, 0x80, 0x68, 0x94}, 4) == 0);
  assert(tag.antenna == 1);
  assert(tag.channel == 2);
  assert(tag.rssi_tenth_dbm == (int16_t)0xFE0C);
}

static void test_bad_crc_and_invalid_epc_are_rejected(void) {
  static const uint8_t tag_data[] = {
      0x00, 0xC8, 0x01, 0x00, 0x04, 0xE2, 0x80, 0x68, 0x94,
  };
  uint8_t frame[MU910_MAX_FRAME_SIZE];
  const size_t frame_length =
      make_response(frame, 0x0001, 0x00, tag_data, sizeof(tag_data));
  frame[frame_length - 1] ^= 0x01;

  mu910_parser_t parser;
  mu910_parser_init(&parser);
  response_count = 0;
  mu910_parser_feed(&parser, frame, frame_length, capture_response, NULL);
  assert(response_count == 0);

  mu910_response_t invalid = {
      .command = 0x0001,
      .status = 0,
      .data = (uint8_t[]){0x00, 0xC8, 0x01, 0x00, 0x03, 0xE2, 0x80, 0x68},
      .data_length = 8,
  };
  mu910_inventory_tag_t tag;
  assert(!mu910_parse_inventory_tag(&invalid, &tag));
}

int main(void) {
  test_crc_reference_vector();
  test_command_frames();
  test_stream_parser_and_tag_payload();
  test_bad_crc_and_invalid_epc_are_rejected();
  puts("MU910-M protocol tests passed");
  return 0;
}
