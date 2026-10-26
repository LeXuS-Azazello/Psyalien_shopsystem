import { applicationName } from "./index.ts";
import { loadAppConfig } from "./config.ts";
import { createApiServer } from "./http/api-server.ts";
import { startMqttBridge } from "./integrations/mqtt/mqtt-bridge.ts";
import { SqliteInventoryStore } from "./storage/inventory-store.ts";
import { RedisInventoryStore } from "./storage/redis-session-store.ts";
import { createCf601Driver } from "./drivers/cf601-usb.ts";
import { createMu910Driver } from "./drivers/mu910-uart.ts";

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

const cf601Driver = config.rfidCf601Enabled ? createCf601Driver(config) : undefined;
const mu910Driver = config.rfidMu910Enabled
  ? createMu910Driver(config, store)
  : undefined;

if (cf601Driver) {
  cf601Driver.start();
}
if (mu910Driver) {
  mu910Driver.start();
}

server.listen(config.port, config.host, () => {
  console.info(`${applicationName} API listening on http://${config.host}:${config.port}`);
  console.info(`SQLite database: ${config.databasePath}`);
  if (config.redisUrl) {
    console.info(`Sessions stored in Redis: ${config.redisUrl}`);
  }
  if (cf601Driver) {
    console.info(`CF-601 USB reader active (readerId=${config.rfidCf601ReaderId})`);
  }
  if (mu910Driver) {
    console.info(`MU910-M UART reader active (readerId=${config.rfidMu910ReaderId})`);
  }
});

if (mqttClient) {
  console.info(`MQTT ingestion enabled for ${config.mqttTopic}`);
}

function shutdown(): void {
  cf601Driver?.stop();
  mu910Driver?.stop();
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