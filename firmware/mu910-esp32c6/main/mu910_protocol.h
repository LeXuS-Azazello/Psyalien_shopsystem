#ifndef MU910_PROTOCOL_H
#define MU910_PROTOCOL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MU910_MAX_EPC_BYTES 64
#define MU910_MAX_FRAME_SIZE 262

typedef struct {
  uint8_t bytes[MU910_MAX_FRAME_SIZE];
  size_t length;
  size_t expected_length;
} mu910_parser_t;

typedef struct {
  uint16_t command;
  uint8_t address;
  uint8_t status;
  const uint8_t *data;
  size_t data_length;
} mu910_response_t;

typedef struct {
  uint8_t epc[MU910_MAX_EPC_BYTES];
  uint8_t epc_length;
  uint8_t antenna;
  uint8_t channel;
  int16_t rssi_tenth_dbm;
} mu910_inventory_tag_t;

typedef void (*mu910_response_callback_t)(
    const mu910_response_t *response, void *context);

uint16_t mu910_crc16(const uint8_t *data, size_t length);
size_t mu910_build_command(uint8_t address, uint16_t command,
                           const uint8_t *payload, size_t payload_length,
                           uint8_t *output, size_t output_capacity);
size_t mu910_build_module_init(uint8_t *output, size_t output_capacity);
size_t mu910_build_get_info(uint8_t *output, size_t output_capacity);
size_t mu910_build_inventory(uint8_t duration_seconds, uint8_t *output,
                             size_t output_capacity);
size_t mu910_build_stop_inventory(uint8_t *output, size_t output_capacity);
bool mu910_parse_inventory_tag(const mu910_response_t *response,
                               mu910_inventory_tag_t *tag);
void mu910_parser_init(mu910_parser_t *parser);
void mu910_parser_feed(mu910_parser_t *parser, const uint8_t *data,
                       size_t length, mu910_response_callback_t callback,
                       void *context);

#endif
