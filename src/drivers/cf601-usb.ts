import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { AppConfig } from "../config.ts";

export interface Cf601Driver {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createCf601Driver(config: AppConfig): Cf601Driver {
  let child: ChildProcess | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const args = [
    "scripts/cf601_usb.py",
    "--duration",
    "60",
    "--reader-id",
    config.rfidCf601ReaderId,
    "--dedupe-ms",
    "1000",
  ];
  if (config.rfidCf601ApiUrl) {
    args.push("--api-url", config.rfidCf601ApiUrl);
  }
  if (config.rfidCf601ApiToken) {
    args.push("--api-token", config.rfidCf601ApiToken);
  }

  function start() {
    if (stopped || child) return;
    child = spawn("python3", args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CF601_SDK_LIBRARY: process.env.CF601_SDK_LIBRARY ?? "",
      },
    });

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      try {
        const event = JSON.parse(line) as {
          epc?: string;
          readerId?: string;
          observedAt?: string;
          status?: string;
        };
        if (event.status === "accepted" || event.status === "duplicate") {
          console.info(
            `CF-601 ${event.status}: EPC ${event.epc ?? "?"}`,
          );
        }
      } catch {
        // ignore non-JSON lines
      }
    });

    child.stderr!.on("data", (data: Buffer) => {
      const text = data.toString("utf8").trim();
      if (text) console.info(`CF-601: ${text}`);
    });

    child.on("exit", (code) => {
      console.info(`CF-601 scan process exited (code ${code ?? "null"}); restarting in 2s`);
      child = null;
      if (!stopped) {
        timer = setTimeout(start, 2_000);
      }
    });

    child.on("error", (error) => {
      console.error("CF-601 driver error:", error.message);
      child = null;
      if (!stopped) {
        timer = setTimeout(start, 2_000);
      }
    });
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (child) {
      child.kill("SIGTERM");
      child = null;
    }
  }

  function isRunning(): boolean {
    return child !== null;
  }

  return { start, stop, isRunning };
}