import { serve, type ServerType } from "@hono/node-server";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { formatEaddrInUseMessage } from "./operator/bind-errors.js";

/**
 * Server entry. Loads config, builds the app, binds to HOST:PORT, and wires
 * graceful shutdown (SIGINT/SIGTERM) so systemd `Restart=on-failure` plus
 * `TimeoutStopSec` can drain in-flight requests cleanly.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp({ config });

  const server: ServerType = serve(
    {
      fetch: app.hono.fetch,
      hostname: config.host,
      port: config.port,
    },
    (info) => {
      logStartup({
        host: info.address,
        port: info.port,
        bridgeGeneration: config.bridgeGeneration,
      });
    },
  );

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(formatEaddrInUseMessage(config.host, config.port));
      process.exit(1);
    }
    log({ level: "error", msg: "server error", error: err.message, code: err.code });
    process.exit(1);
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    log({ level: "info", msg: "shutdown signal received", signal });
    server.close((err?: Error) => {
      if (err) {
        log({ level: "error", msg: "shutdown error", error: err.message });
        process.exit(1);
      }
      log({ level: "info", msg: "shutdown complete" });
      process.exit(0);
    });
    // Hard ceiling so systemd's TimeoutStopSec doesn't kill us mid-log.
    setTimeout(() => {
      log({ level: "warn", msg: "shutdown timed out, forcing exit" });
      process.exit(1);
    }, 30_000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function logStartup(info: {
  host: string;
  port: number;
  bridgeGeneration: number;
}): void {
  log({
    level: "info",
    msg: "h31d3nt0r listening",
    host: info.host,
    port: info.port,
    bridgeGeneration: info.bridgeGeneration,
  });
}

function log(record: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...record }));
}

await main();
