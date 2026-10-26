#include <inttypes.h>
#include <stdio.h>
#include <string.h>

#include "driver/uart.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mu910_protocol.h"

#define MU910_UART_PORT UART_NUM_1
#define MU910_UART_BAUD_RATE 115200
#define MU910_UART_RX_BUFFER_SIZE 2048
#define MU910_UART_READ_SIZE 128
#define MU910_UART_RX_SAMPLE_SIZE 16
#define MU910_INFO_TIMEOUT_MS 2000
#define MU910_INFO_RETRIES 3

static const char *TAG = "mu910";
static mu910_parser_t parser;
static bool module_identified;
static bool module_initialized;
static uint32_t uart_received_bytes;
static uint8_t uart_rx_sample[MU910_UART_RX_SAMPLE_SIZE];
static size_t uart_rx_sample_length;

static esp_err_t send_command(const uint8_t *frame, size_t length) {
  const int written = uart_write_bytes(MU910_UART_PORT, frame, length);
  if (written < 0 || (size_t)written != length) {
    ESP_LOGE(TAG, "UART write failed (%d of %u bytes)", written,
             (unsigned)length);
    return ESP_FAIL;
  }
  return ESP_OK;
}

static void log_inventory_tag(const mu910_inventory_tag_t *tag) {
  char epc[MU910_MAX_EPC_BYTES * 2 + 1];
  for (size_t i = 0; i < tag->epc_length; i++) {
    (void)snprintf(&epc[i * 2], sizeof(epc) - i * 2, "%02X", tag->epc[i]);
  }
  epc[tag->epc_length * 2] = '\0';

  ESP_LOGI(TAG, "RFID_TAG epc=%s antenna=%u channel=%u rssi_tenth_dbm=%d",
           epc, tag->antenna, tag->channel, tag->rssi_tenth_dbm);
}

static void handle_response(const mu910_response_t *response, void *context) {
  bool *inventory_finished = context;

  if (response->command == 0x0050) {
    if (response->status == 0) {
      module_initialized = true;
      ESP_LOGI(TAG, "MU910-M module initialization acknowledged");
    } else {
      ESP_LOGE(TAG, "Module initialization failed (status 0x%02X)",
               response->status);
    }
    return;
  }

  if (response->command == 0x0051) {
    if (response->status != 0) {
      ESP_LOGE(TAG, "Module information request failed (status 0x%02X)",
               response->status);
      return;
    }
    module_identified = true;
    ESP_LOGI(TAG, "MU910-M responded to GET_INFO (data length %u)",
             (unsigned)response->data_length);
    return;
  }

  if (response->command != 0x0001) {
    return;
  }

  if (response->status == 0x12) {
    if (inventory_finished != NULL) {
      *inventory_finished = true;
    }
    ESP_LOGI(TAG, "Inventory burst completed");
    return;
  }

  if (response->status != 0) {
    ESP_LOGW(TAG, "Inventory response status 0x%02X", response->status);
    return;
  }

  mu910_inventory_tag_t tag;
  if (!mu910_parse_inventory_tag(response, &tag)) {
    ESP_LOGW(TAG, "Ignored malformed or unsupported inventory response");
    return;
  }
  log_inventory_tag(&tag);
}

static void read_uart(mu910_response_callback_t callback, void *context,
                      uint32_t timeout_ms) {
  uint8_t bytes[MU910_UART_READ_SIZE];
  const int received = uart_read_bytes(MU910_UART_PORT, bytes, sizeof(bytes),
                                       pdMS_TO_TICKS(timeout_ms));
  if (received > 0) {
    uart_received_bytes += (uint32_t)received;
    const size_t sample_remaining =
        sizeof(uart_rx_sample) - uart_rx_sample_length;
    const size_t sample_length =
        (size_t)received < sample_remaining ? (size_t)received
                                            : sample_remaining;
    memcpy(&uart_rx_sample[uart_rx_sample_length], bytes, sample_length);
    uart_rx_sample_length += sample_length;
    mu910_parser_feed(&parser, bytes, (size_t)received, callback, context);
  }
}

static void initialize_uart(void) {
  const uart_config_t config = {
      .baud_rate = MU910_UART_BAUD_RATE,
      .data_bits = UART_DATA_8_BITS,
      .parity = UART_PARITY_DISABLE,
      .stop_bits = UART_STOP_BITS_1,
      .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
      .source_clk = UART_SCLK_DEFAULT,
  };

  ESP_ERROR_CHECK(uart_driver_install(MU910_UART_PORT,
                                      MU910_UART_RX_BUFFER_SIZE, 0, 0, NULL,
                                      0));
  ESP_ERROR_CHECK(uart_param_config(MU910_UART_PORT, &config));
  ESP_ERROR_CHECK(uart_set_pin(MU910_UART_PORT, CONFIG_MU910_UART_TX_GPIO,
                               CONFIG_MU910_UART_RX_GPIO,
                               UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
  mu910_parser_init(&parser);
}

static bool identify_module(void) {
  uint8_t init_frame[MU910_MAX_FRAME_SIZE];
  uint8_t frame[MU910_MAX_FRAME_SIZE];
  const size_t init_length =
      mu910_build_module_init(init_frame, sizeof(init_frame));
  const size_t frame_length = mu910_build_get_info(frame, sizeof(frame));
  uart_received_bytes = 0;
  uart_rx_sample_length = 0;
  if (init_length == 0 || frame_length == 0) {
    ESP_LOGE(TAG, "Could not construct module initialization or GET_INFO request");
    return false;
  }

  module_initialized = false;
  uart_flush_input(MU910_UART_PORT);
  ESP_LOGI(TAG, "Initializing reader (non-RF command)");
  if (send_command(init_frame, init_length) != ESP_OK) {
    return false;
  }
  const int64_t init_deadline =
      esp_timer_get_time() + (int64_t)MU910_INFO_TIMEOUT_MS * 1000;
  while (!module_initialized && esp_timer_get_time() < init_deadline) {
    read_uart(handle_response, NULL, 100);
  }
  if (!module_initialized) {
    ESP_LOGW(TAG, "No module-init acknowledgment; trying GET_INFO anyway");
  }

  uart_received_bytes = 0;
  uart_rx_sample_length = 0;
  for (uint8_t attempt = 1; attempt <= MU910_INFO_RETRIES; attempt++) {
    module_identified = false;
    uart_flush_input(MU910_UART_PORT);
    ESP_LOGI(TAG, "Requesting module information (attempt %u/%u)", attempt,
             MU910_INFO_RETRIES);
    if (send_command(frame, frame_length) != ESP_OK) {
      return false;
    }

    const int64_t deadline =
        esp_timer_get_time() + (int64_t)MU910_INFO_TIMEOUT_MS * 1000;
    while (!module_identified && esp_timer_get_time() < deadline) {
      read_uart(handle_response, NULL, 100);
    }
    if (module_identified) {
      return true;
    }
  }

  ESP_LOGE(TAG,
           "No valid GET_INFO response after receiving %" PRIu32
           " UART bytes; verify reader power, 115200 8N1, crossed TX/RX, "
           "common GND, and the MU910-M v1.3 pinout",
           uart_received_bytes);
  if (uart_rx_sample_length > 0) {
    ESP_LOG_BUFFER_HEX_LEVEL(TAG, uart_rx_sample, uart_rx_sample_length,
                             ESP_LOG_ERROR);
  }
  return false;
}

#if CONFIG_MU910_ENABLE_INVENTORY
static void run_inventory(void) {
  uint8_t frame[MU910_MAX_FRAME_SIZE];
  const size_t frame_length =
      mu910_build_inventory(CONFIG_MU910_INVENTORY_DURATION_SEC, frame,
                            sizeof(frame));
  if (frame_length == 0) {
    ESP_LOGE(TAG, "Could not construct inventory request");
    return;
  }

  bool finished = false;
  ESP_LOGW(TAG, "RF inventory enabled; ensure antenna and local RF settings "
                "are approved");
  if (send_command(frame, frame_length) != ESP_OK) {
    return;
  }

  const int64_t deadline =
      esp_timer_get_time() +
      ((int64_t)CONFIG_MU910_INVENTORY_DURATION_SEC + 3) * 1000000;
  while (!finished && esp_timer_get_time() < deadline) {
    read_uart(handle_response, &finished, 100);
  }

  if (!finished) {
    ESP_LOGW(TAG, "Inventory completion response timed out; sending STOP");
    const size_t stop_length =
        mu910_build_stop_inventory(frame, sizeof(frame));
    if (stop_length > 0) {
      (void)send_command(frame, stop_length);
    }
  }

  vTaskDelay(pdMS_TO_TICKS(CONFIG_MU910_INVENTORY_COOLDOWN_SEC * 1000));
}
#endif

void app_main(void) {
  initialize_uart();
  ESP_LOGI(TAG,
           "MU910-M UART ready: baud=%d, ESP TX GPIO=%d, ESP RX GPIO=%d",
           MU910_UART_BAUD_RATE, CONFIG_MU910_UART_TX_GPIO,
           CONFIG_MU910_UART_RX_GPIO);

  if (!identify_module()) {
    ESP_LOGE(TAG, "Reader remains idle; no inventory command was sent");
    return;
  }

#if CONFIG_MU910_ENABLE_INVENTORY
  while (true) {
    run_inventory();
  }
#else
  ESP_LOGW(TAG,
           "RF inventory is disabled. Confirm antenna band and local "
           "regulations before enabling it in menuconfig.");
  while (true) {
    read_uart(handle_response, NULL, 1000);
  }
#endif
}
