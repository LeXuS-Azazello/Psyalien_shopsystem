import { connect, type MqttClient } from "mqtt";
import type { AppConfig } from "../../config.ts";
import type { InventoryStore } from "../../storage/inventory-store.ts";
import { parseScanEvent } from "./scan-event.ts";

export function startMqttBridge(
  config: AppConfig,
  store: InventoryStore,
): MqttClient {
  const client = connect(config.mqttUrl, {
    clientId: config.mqttClientId,
    clean: false,
    keepalive: 30,
    protocolVersion: 5,
    reconnectPeriod: 2_000,
    properties: { sessionExpiryInterval: 86_400 },
    ...(config.mqttUsername
      ? { username: config.mqttUsername, password: config.mqttPassword }
      : {}),
    customHandleAcks: (_topic, payload, _packet, acknowledge) => {
      void (async () => {
        let event;
        try {
          event = parseScanEvent(payload);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Invalid RFID event";
          console.error(`Discarding malformed MQTT event: ${message}`);
          acknowledge(128);
          return;
        }

        try {
          const result = await store.recordScanEvent(event);
          console.info(
            `${result.status === "duplicate" ? "Recognized" : "Stored"} RFID scan event ${event.eventId}`,
          );
          acknowledge(0);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown database error";
          console.error(
            `Could not persist RFID event ${event.eventId}; MQTT delivery left unacknowledged: ${message}`,
          );
          acknowledge(error instanceof Error ? error : new Error(message));
        }
      })();
    },
  });

  client.on("connect", () => {
    client.subscribe(config.mqttTopic, { qos: 1 }, (error) => {
      if (error) {
        client.emit("error", error);
        return;
      }
      console.info(`Subscribed to MQTT topic ${config.mqttTopic}`);
    });
  });

  client.on("error", (error) => {
    console.error("MQTT client error:", error.message);
  });

  return client;
}
