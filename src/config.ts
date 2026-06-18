import "dotenv/config";

/** Worker configuration, parsed from env with safe defaults. */

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
}

export const config = {
  port: num("PORT", 8080),
  /** Bearer secret for POST /comparables. /health is public. */
  secret: process.env.CMA_WORKER_SECRET ?? "",
  // PART A — optional residential/ISP egress proxy (egress IP only; the SITE
  // still mints its own reCAPTCHA token). Unset = direct connection.
  proxyServer: process.env.PROXY_SERVER ?? "",
  proxyUsername: process.env.PROXY_USERNAME ?? "",
  proxyPassword: process.env.PROXY_PASSWORD ?? "",
  maxConcurrency: num("MAX_CONCURRENCY", 1),
  fetchDelayMs: num("FETCH_DELAY_MS", 2750),
  cooldownMs: num("COOLDOWN_MS", 30_000),
  maxRetries: num("MAX_RETRIES", 3),
  monthsBack: num("MONTHS_BACK", 12),
  nadlanBaseUrl: str("NADLAN_BASE_URL", "https://www.nadlan.gov.il"),
  logLevel: str("LOG_LEVEL", "info"),
} as const;
