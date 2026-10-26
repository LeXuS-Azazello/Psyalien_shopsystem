import { applicationName } from "./index.ts";
import { loadAppConfig } from "./config.ts";
import { createApiServer } from "./http/api-server.ts";
import { startMqttBridge } from "./integrations/mqtt/mqtt-bridge.ts";
import { SqliteInventoryStore } from "./storage/inventory-store.ts";

const config = loadAppConfig(process.env);
const store = new SqliteInventoryStore(config.databasePath);
const server = createApiServer(store, config.apiToken);
const mqttClient = config.mqttEnabled
  ? startMqttBridge(config, store)
  : undefined;

server.listen(config.port, config.host, () => {
  console.info(`${applicationName} API listening on http://${config.host}:${config.port}`);
  console.info(`SQLite database: ${config.databasePath}`);
});

if (mqttClient) {
  console.info(`MQTT ingestion enabled for ${config.mqttTopic}`);
}

function shutdown(): void {
  server.close(() => {
    if (mqttClient) {
      mqttClient.end(false, {}, () => store.close());
    } else {
      store.close();
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
