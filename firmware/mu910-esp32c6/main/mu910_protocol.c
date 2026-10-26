#include "mu910_protocol.h"

#include <string.h>

#define MU910_FRAME_HEAD 0xCF
#define MU910_COMMAND_INVENTORY 0x0001
#define MU910_COMMAND_STOP_INVENTORY 0x0002
#define MU910_COMMAND_MODULE_INIT 0x0050
#define MU910_COMMAND_GET_INFO 0x0051

uint16_t mu910_crc16(const uint8_t *data, size_t length) {
  uint16_t crc = 0xFFFF;

  for (size_t i = 0; i < length; i++) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; bit++) {
      crc = (crc & 1U) != 0U ? (uint16_t)((crc >> 1) ^ 0x8408U)
                            : (uint16_t)(crc >> 1);
    }
  }

  return crc;
}

size_t mu910_build_command(uint8_t address, uint16_t command,
                           const uint8_t *payload, size_t payload_length,
                           uint8_t *output, size_t output_capacity) {
  const size_t frame_length = payload_length + 7;
  if (output == NULL || payload_length > UINT8_MAX ||
      (payload_length > 0 && payload == NULL) ||
      output_capacity < frame_length) {
    return 0;
  }

  output[0] = MU910_FRAME_HEAD;
  output[1] = address;
  output[2] = (uint8_t)(command >> 8);
  output[3] = (uint8_t)command;
  output[4] = (uint8_t)payload_length;
  if (payload_length > 0) {
    memcpy(&output[5], payload, payload_length);
  }

  const uint16_t crc = mu910_crc16(output, frame_length - 2);
  output[frame_length - 2] = (uint8_t)(crc >> 8);
  output[frame_length - 1] = (uint8_t)crc;
  return frame_length;
}

size_t mu910_build_get_info(uint8_t *output, size_t output_capacity) {
  return mu910_build_command(0xFF, MU910_COMMAND_GET_INFO, NULL, 0, output,
                             output_capacity);
}

size_t mu910_build_module_init(uint8_t *output, size_t output_capacity) {
  return mu910_build_command(0xFF, MU910_COMMAND_MODULE_INIT, NULL, 0, output,
                             output_capacity);
}

size_t mu910_build_inventory(uint8_t duration_seconds, uint8_t *output,
                             size_t output_capacity) {
  const uint8_t payload[5] = {
      0x00, 0x00, 0x00, 0x00, duration_seconds,
  };
  return mu910_build_command(0xFF, MU910_COMMAND_INVENTORY, payload,
                             sizeof(payload), output, output_capacity);
}

size_t mu910_build_stop_inventory(uint8_t *output, size_t output_capacity) {
  return mu910_build_command(0xFF, MU910_COMMAND_STOP_INVENTORY, NULL, 0,
                             output, output_capacity);
}

bool mu910_parse_inventory_tag(const mu910_response_t *response,
                               mu910_inventory_tag_t *tag) {
  if (response == NULL || tag == NULL || response->command != MU910_COMMAND_INVENTORY ||
      response->status != 0 || response->data == NULL ||
      response->data_length < 5) {
    return false;
  }

  const uint8_t epc_length = response->data[4];
  if (epc_length < 2 || epc_length > MU910_MAX_EPC_BYTES ||
      (epc_length % 2) != 0 ||
      response->data_length != (size_t)epc_length + 5) {
    return false;
  }

  tag->rssi_tenth_dbm = (int16_t)(((uint16_t)response->data[0] << 8) |
                                  response->data[1]);
  tag->antenna = response->data[2];
  tag->channel = response->data[3];
  tag->epc_length = epc_length;
  memcpy(tag->epc, &response->data[5], epc_length);
  return true;
}

void mu910_parser_init(mu910_parser_t *parser) {
  if (parser != NULL) {
    memset(parser, 0, sizeof(*parser));
  }
}

static void mu910_parser_reset(mu910_parser_t *parser) {
  parser->length = 0;
  parser->expected_length = 0;
}

static void mu910_parser_consume(mu910_parser_t *parser,
                                 mu910_response_callback_t callback,
                                 void *context) {
  const uint8_t declared_length = parser->bytes[4];
  const uint16_t received_crc =
      (uint16_t)(((uint16_t)parser->bytes[parser->length - 2] << 8) |
                 parser->bytes[parser->length - 1]);
  const uint16_t calculated_crc =
      mu910_crc16(parser->bytes, parser->length - 2);

  if (declared_length < 1 || received_crc != calculated_crc) {
    mu910_parser_reset(parser);
    return;
  }

  mu910_response_t response = {
      .address = parser->bytes[1],
      .command = (uint16_t)(((uint16_t)parser->bytes[2] << 8) |
                            parser->bytes[3]),
      .status = parser->bytes[5],
      .data = &parser->bytes[6],
      .data_length = (size_t)declared_length - 1,
  };

  if (callback != NULL) {
    callback(&response, context);
  }
  mu910_parser_reset(parser);
}

void mu910_parser_feed(mu910_parser_t *parser, const uint8_t *data,
                       size_t length, mu910_response_callback_t callback,
                       void *context) {
  if (parser == NULL || (length > 0 && data == NULL)) {
    return;
  }

  for (size_t i = 0; i < length; i++) {
    const uint8_t byte = data[i];
    if (parser->length == 0) {
      if (byte == MU910_FRAME_HEAD) {
        parser->bytes[0] = byte;
        parser->length = 1;
      }
      continue;
    }

    if (parser->length >= MU910_MAX_FRAME_SIZE) {
      mu910_parser_reset(parser);
      if (byte == MU910_FRAME_HEAD) {
        parser->bytes[0] = byte;
        parser->length = 1;
      }
      continue;
    }

    parser->bytes[parser->length++] = byte;
    if (parser->length == 5) {
      const uint8_t declared_length = parser->bytes[4];
      if (declared_length < 1) {
        mu910_parser_reset(parser);
        continue;
      }
      parser->expected_length = (size_t)declared_length + 7;
    }
    if (parser->expected_length > 0 &&
        parser->length == parser->expected_length) {
      mu910_parser_consume(parser, callback, context);
    }
  }
}
