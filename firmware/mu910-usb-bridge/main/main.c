#include <stdint.h>
#include <stdlib.h>

#include "driver/uart.h"
#include "driver/usb_serial_jtag.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define READER_UART UART_NUM_1
#define READER_UART_BAUD 115200
#define BRIDGE_BUFFER_SIZE 256

static const char *TAG = "mu910_bridge";

static void usb_to_reader_task(void *context) {
  (void)context;
  uint8_t buffer[BRIDGE_BUFFER_SIZE];

  while (true) {
    const int received = usb_serial_jtag_read_bytes(
        buffer, sizeof(buffer), pdMS_TO_TICKS(20));
    if (received <= 0) {
      continue;
    }

    const int written = uart_write_bytes(READER_UART, buffer, received);
    if (written != received) {
      ESP_LOGE(TAG, "USB-to-UART forwarding failed (%d of %d bytes)", written,
               received);
    }
  }
}

static void reader_to_usb_task(void *context) {
  (void)context;
  uint8_t buffer[BRIDGE_BUFFER_SIZE];

  while (true) {
    const int received =
        uart_read_bytes(READER_UART, buffer, sizeof(buffer), pdMS_TO_TICKS(20));
    if (received <= 0) {
      continue;
    }

    const int written =
        usb_serial_jtag_write_bytes(buffer, received, pdMS_TO_TICKS(100));
    if (written != received) {
      ESP_LOGE(TAG, "UART-to-USB forwarding failed (%d of %d bytes)", written,
               received);
    }
  }
}

void app_main(void) {
  const uart_config_t uart_config = {
      .baud_rate = READER_UART_BAUD,
      .data_bits = UART_DATA_8_BITS,
      .parity = UART_PARITY_DISABLE,
      .stop_bits = UART_STOP_BITS_1,
      .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
      .source_clk = UART_SCLK_DEFAULT,
  };
  usb_serial_jtag_driver_config_t usb_config =
      USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();

  ESP_ERROR_CHECK(uart_driver_install(READER_UART, 2048, 2048, 0, NULL, 0));
  ESP_ERROR_CHECK(uart_param_config(READER_UART, &uart_config));
  ESP_ERROR_CHECK(uart_set_pin(READER_UART, CONFIG_MU910_UART_TX_GPIO,
                               CONFIG_MU910_UART_RX_GPIO,
                               UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
  ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb_config));

  ESP_LOGI(TAG, "Transparent bridge ready: USB Serial/JTAG <-> UART1");
  ESP_LOGI(TAG, "UART1 is 115200 8N1, TX GPIO%d, RX GPIO%d",
           CONFIG_MU910_UART_TX_GPIO, CONFIG_MU910_UART_RX_GPIO);

  if (xTaskCreate(usb_to_reader_task, "usb_to_reader", 3072, NULL, 10, NULL) !=
          pdPASS ||
      xTaskCreate(reader_to_usb_task, "reader_to_usb", 3072, NULL, 10, NULL) !=
          pdPASS) {
    ESP_LOGE(TAG, "Could not create bridge tasks");
    abort();
  }
}
