idf_component_register(
  SRCS "main.c" "mu910_protocol.c"
  INCLUDE_DIRS "."
  REQUIRES esp_driver_uart esp_timer
)
