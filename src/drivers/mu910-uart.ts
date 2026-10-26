import { createInterface } from "node:readline";
import type { AppConfig } from "../config.ts";
import type { InventoryStore } from "../storage/inventory-store.ts";
import { parseScanEvent } from "../integrations/mqtt/scan-event.ts";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

export interface Mu910Driver {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createMu910Driver(
  config: AppConfig,
  store: InventoryStore,
): Mu910Driver {
  let socket: ReturnType<typeof createConnection> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let buffer = "";
  let lastSend = 0;

  function flush() {
    const now = Date.now();
    if (now - lastSend < 200) return;
    lastSend = now;
    if (socket) {
      socket.write("AT+INVENTORY=START\r\n");
    }
  }

  function emitEpc(epc: string, readerId: string) {
    const event = {
      eventId: randomUUID(),
      epc,
      readerId,
      observedAt: new Date().toISOString(),
    };
    try {
      const parsed = parseScanEvent(Buffer.from(JSON.stringify(event)));
      void store.recordScanEvent(parsed).then((result) => {
        console.info(
          `MU910-M ${result.status === "duplicate" ? "Recognized" : "Stored"} EPC ${epc}`,
        );
      });
    } catch (error) {
      console.error("MU910-M could not record event:", error instanceof Error ? error.message : error);
    }
  }

  function start() {
    if (stopped) return;
    const url = new URL(config.rfidMu910ApiUrl || "http://127.0.0.1:3000");
    const port = Number(url.port) || 3000;
    const host = url.hostname || "127.0.0.1";
    socket = createConnection({ host, port }, () => {
      console.info(`MU910-M connected to ${host}:${port}`);
    });
    socket.on("error", (error) => {
      console.error("MU910-M connection error:", error.message);
      socket = null;
      if (!stopped) {
        timer = setTimeout(start, 2_000);
      }
    });
    socket.on("close", () => {
      console.info("MU910-M socket closed; reconnecting in 2s");
      socket = null;
      if (!stopped) {
        timer = setTimeout(start, 2_000);
      }
    });
    socket.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/EPC:([0-9A-Fa-f]+)/);
        if (match?.[1]) {
          emitEpc(match[1].toUpperCase(), config.rfidMu910ReaderId);
        } else {
          console.info(`MU910-M: ${trimmed}`);
        }
      }
    });
    timer = setInterval(flush, 500);
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (socket) {
      socket.destroy();
      socket = null;
    }
  }

  function isRunning(): boolean {
    return socket !== null;
  }

  return { start, stop, isRunning };
}