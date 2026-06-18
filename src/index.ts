import { config } from "./config.js";
import { log } from "./log.js";
import { launchBrowser, closeBrowser } from "./browser.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  // FIRST line — proves node reached index.ts (if this is absent from Deploy
  // Logs, the hang is before node: xvfb-run / the Docker CMD).
  log.info("boot: starting");

  if (!config.secret) {
    log.warn("CMA_WORKER_SECRET is empty — /comparables auth will reject (503/401).");
  }

  // 1) Start the HTTP server FIRST so the port binds and /health responds
  //    immediately. A slow or failing headed-browser launch must NOT block the
  //    listener — that was the Railway 502 (nothing listening on the port).
  const app = buildServer();
  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info(`boot: listening on :${config.port} (process.env.PORT=${process.env.PORT ?? "unset"})`);

  // 2) Launch the headed browser in the BACKGROUND. /health reports browser
  //    up/down (503 until up); the server keeps listening regardless.
  //    chromium.launch throws within its own timeout on failure — log it
  //    loudly instead of hanging silently. (browser.ts logs the success line.)
  void launchBrowser().catch((err) =>
    log.error({ err }, "boot: headed-browser launch FAILED — /health stays down until it succeeds")
  );

  const shutdown = async (sig: string): Promise<void> => {
    log.info(`${sig} — shutting down`);
    await app.close().catch(() => {});
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error({ err }, "fatal boot error");
  process.exit(1);
});
