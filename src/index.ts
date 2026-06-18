import { config } from "./config.js";
import { log } from "./log.js";
import { launchBrowser, closeBrowser } from "./browser.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  if (!config.secret) {
    log.warn("CMA_WORKER_SECRET is empty — /comparables auth will reject (503/401).");
  }

  // Boot the headed browser so /health reflects real readiness AND the
  // xvfb + headed-Chromium container setup is validated at deploy time.
  await launchBrowser().catch((err) => {
    log.error({ err }, "browser launch failed at boot");
  });

  const app = buildServer();
  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info(`proply-cma-worker listening on :${config.port}`);

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
