import { config } from "./config.js";

/**
 * Serialized work queue. With MAX_CONCURRENCY=1 (default) requests never
 * overlap — one warm headed browser, one nadlan session at a time. This is the
 * politeness backbone: it guarantees the pacing/cooldown is never undercut by
 * concurrent navigations against the site.
 */

type Task<T> = () => Promise<T>;

let active = 0;
const waiting: Array<() => void> = [];

/** active + queued — surfaced by GET /health. */
export function queueDepth(): number {
  return active + waiting.length;
}

async function acquire(): Promise<void> {
  if (active >= config.maxConcurrency) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
}

function release(): void {
  active--;
  waiting.shift()?.();
}

export async function enqueue<T>(task: Task<T>): Promise<T> {
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
}
