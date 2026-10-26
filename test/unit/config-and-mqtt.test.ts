import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "../../src/config.ts";
import { parseScanEvent } from "../../src/integrations/mqtt/scan-event.ts";

const validEvent = {
  eventId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  epc: "e28068940000502c6fe3bcae",
  readerId: "gateway-01",
  observedAt: "2026-10-26T02:30:00Z",
};

test("parses MQTT events and canonicalizes EPC and observation time", () => {
  const event = parseScanEvent(Buffer.from(JSON.stringify(validEvent)));
  assert.equal(event.epc, "E28068940000502C6FE3BCAE");
  assert.equal(event.observedAt, "2026-10-26T02:30:00.000Z");
});

test("rejects malformed MQTT events without exposing payload data", () => {
  assert.throws(
    () =>
      parseScanEvent(
        Buffer.from(JSON.stringify({ ...validEvent, epc: "not-hex" })),
      ),
    /epc/,
  );
  assert.throws(() => parseScanEvent(Buffer.from("{")), /valid JSON/);
});

test("requires an API token before binding the HTTP API outside localhost", () => {
  assert.throws(
    () => loadAppConfig({ HTTP_HOST: "0.0.0.0" }),
    /API_TOKEN is required/,
  );
  assert.throws(
    () =>
      loadAppConfig({
        HTTP_HOST: "0.0.0.0",
        API_TOKEN: "too-short",
      }),
    /at least 32 characters/,
  );
  const config = loadAppConfig({
    HTTP_HOST: "0.0.0.0",
    API_TOKEN: "a".repeat(32),
  });
  assert.equal(config.apiToken, "a".repeat(32));
});

test("validates MQTT credentials as a pair when enabled", () => {
  assert.throws(
    () =>
      loadAppConfig({
        MQTT_ENABLED: "true",
        MQTT_USERNAME: "reader",
      }),
    /must either both be set or both be empty/,
  );
});
