import Fastify from "fastify";
import { log } from "./log.js";
import { isBrowserUp } from "./browser.js";
import { queueDepth } from "./queue.js";
import { requireAuth } from "./auth.js";
import { validateInput, getComparables } from "./nadlan/service.js";

// Return type is inferred: Fastify({ loggerInstance }) parameterizes the
// instance with the pino logger type, which an explicit FastifyInstance
// annotation (default logger) would reject.
export function buildServer() {
  const app = Fastify({ loggerInstance: log, bodyLimit: 64 * 1024 });

  app.get("/health", async (_req, reply) => {
    const up = isBrowserUp();
    return reply.code(up ? 200 : 503).send({
      ok: up,
      browser: up ? "up" : "down",
      queue_depth: queueDepth(),
    });
  });

  app.post("/comparables", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = validateInput(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error, code: "bad_request" });
    try {
      const result = await getComparables(parsed.value);
      return reply.code(200).send(result);
    } catch (err) {
      // Never leak internals (stack/selectors/site details).
      log.error({ err }, "/comparables failed");
      return reply.code(500).send({ error: "internal error", code: "internal" });
    }
  });

  return app;
}
