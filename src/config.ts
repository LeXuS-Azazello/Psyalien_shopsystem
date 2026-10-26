export interface AppConfig {
  host: string;
  port: number;
  apiToken?: string;
  databasePath: string;
  redisUrl?: string;
  mqttEnabled: boolean;
  mqttUrl: string;
  mqttTopic: string;
  mqttClientId: string;
  mqttUsername?: string;
  mqttPassword?: string;
}

function valueOrDefault(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): string {
  const value = env[key]?.trim();
  return value || fallback;
}

function validateUrl(value: string, name: string, protocols: string[]): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials`);
  }
  return url.href;
}

export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const portValue = valueOrDefault(env, "HTTP_PORT", "3000");
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("HTTP_PORT must be an integer between 1 and 65535");
  }

  const enabledValue = valueOrDefault(env, "MQTT_ENABLED", "false");
  if (enabledValue !== "true" && enabledValue !== "false") {
    throw new Error("MQTT_ENABLED must be true or false");
  }
  const mqttEnabled = enabledValue === "true";
  const mqttUsername = env.MQTT_USERNAME?.trim();
  const mqttPassword = env.MQTT_PASSWORD?.trim();
  if (mqttEnabled && Boolean(mqttUsername) !== Boolean(mqttPassword)) {
    throw new Error(
      "MQTT_USERNAME and MQTT_PASSWORD must either both be set or both be empty",
    );
  }
  const host = valueOrDefault(env, "HTTP_HOST", "127.0.0.1");
  const apiToken = env.API_TOKEN?.trim();
  if (apiToken && apiToken.length < 32) {
    throw new Error("API_TOKEN must contain at least 32 characters");
  }
  if (
    !["localhost", "127.0.0.1", "::1"].includes(host) &&
    !apiToken
  ) {
    throw new Error(
      "API_TOKEN is required when HTTP_HOST exposes the API beyond localhost",
    );
  }
  const redisUrl = env.REDIS_URL?.trim();

  return {
    host,
    port,
    ...(apiToken ? { apiToken } : {}),
    ...(redisUrl ? { redisUrl } : {}),
    databasePath: valueOrDefault(env, "DATABASE_PATH", "./data/psyalien.sqlite"),
    mqttEnabled,
    mqttUrl: validateUrl(
      valueOrDefault(env, "MQTT_URL", "mqtt://localhost:1883"),
      "MQTT_URL",
      ["mqtt:", "mqtts:", "ws:", "wss:"],
    ),
    mqttTopic: valueOrDefault(env, "MQTT_TOPIC_TAGS", "rfid/tags"),
    mqttClientId: valueOrDefault(env, "MQTT_CLIENT_ID", "psyalien-engine"),
    ...(mqttEnabled && mqttUsername && mqttPassword
      ? { mqttUsername, mqttPassword }
      : {}),
  };
}
