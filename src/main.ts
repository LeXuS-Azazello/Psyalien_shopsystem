import { applicationName } from "./index.ts";
import { loadAppConfig } from "./config.ts";
import { createApiServer } from "./http/api-server.ts";
import { startMqttBridge } from "./integrations/mqtt/mqtt-bridge.ts";
import { SqliteInventoryStore } from "./storage/inventory-store.ts";
import { RedisInventoryStore } from "./storage/redis-session-store.ts";

const config = loadAppConfig(process.env);
const sqliteStore = new SqliteInventoryStore(config.databasePath);
const store =
  config.redisUrl && config.redisUrl.length > 0
    ? new RedisInventoryStore(sqliteStore, config.redisUrl)
    : sqliteStore;
const server = createApiServer(store, config.apiToken);
const mqttClient = config.mqttEnabled
  ? startMqttBridge(config, store)
  : undefined;

server.listen(config.port, config.host, () => {
  console.info(`${applicationName} API listening on http://${config.host}:${config.port}`);
  console.info(`SQLite database: ${config.databasePath}`);
  if (config.redisUrl) {
    console.info(`Sessions stored in Redis: ${config.redisUrl}`);
  }
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
