import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "./config.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Fastify preHandler: require `Authorization: Bearer <CMA_WORKER_SECRET>`.
 * Sending a reply here short-circuits the route. Constant-time compare.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!config.secret) {
    await reply.code(503).send({ error: "worker auth not configured", code: "no_secret" });
    return;
  }
  const header = req.headers["authorization"];
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(token, config.secret)) {
    await reply.code(401).send({ error: "unauthorized", code: "unauthorized" });
  }
}
