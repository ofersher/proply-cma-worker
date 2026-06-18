import type { Page } from "playwright";
import { getBrowser, launchBrowser } from "../browser.js";
import { enqueue } from "../queue.js";
import { config } from "../config.js";
import { log } from "../log.js";
import { decodeDealData, extractItems } from "./decode.js";
import { toComparable } from "./map.js";
import { filterNearSubject, type SubjectFilter } from "./filter.js";
import type { NadlanComparable, RawDeal, ResolvedSettlement } from "./types.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// CP-FIX-1 — speed/safety budget. doFetch self-caps at WORKER_DEADLINE_MS so it
// ALWAYS returns a 200 (with whatever it has) before the Vercel client's
// CMA_WORKER_TIMEOUT_MS (90s) aborts → never a 499. Navigation uses
// domcontentloaded (the nadlan SPA never reaches networkidle → that was the
// up-to-60s goto stall). The scroll loop breaks the instant deal-data lands.
// NOTE: config.fetchDelayMs / config.cooldownMs are no longer used here — the
// 30s cooldown previously blocked a single in-flight request and blew the budget.
const WORKER_DEADLINE_MS = 80_000; // hard overall budget across all attempts
const SCROLL_ITERATIONS = 8; // was 14
const SCROLL_DELAY_MS = 1500; // scroll poll wait (was config.fetchDelayMs = 2750)
const RETRY_GAP_MS = 2000; // tiny gap between attempts (NOT the 30s cooldown)

export interface FetchResult {
  comparables: NadlanComparable[]; // near-subject, room+street+sqm matched, last 12mo
  settlement_sample: NadlanComparable[]; // room-matched buffer (aggregate band)
  meta: {
    settlement_id: string;
    settlement_name: string;
    total_rows: number | null; // 12-month count when the year filter applied
    year_filter_applied: boolean;
    window_truncated: boolean;
    oldest_covered: string | null;
    rooms_matched: number;
    pages_fetched: number;
    got_403: boolean;
    source_url: string;
  };
}

function settlementDealsUrl(id: string): string {
  return `${config.nadlanBaseUrl}/?view=settlement&id=${encodeURIComponent(id)}&page=deals`;
}
function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Drive the site's OWN סינון → "שנה האחרונה" to set the server-side 12-month
 *  bound (page-signed; we only click — no forging). Best-effort. */
async function driveYearFilter(page: Page): Promise<void> {
  await page.locator('button.filterBtn:has-text("סינון")').first().click({ timeout: 2500 }).catch(() => {});
  await sleep(800);
  await page.locator('button.btn:has-text("מכל הזמנים")').first().click({ timeout: 2500 }).catch(() => {});
  await sleep(600);
  // exact text avoids matching "חצי שנה האחרונה" (6-month) by substring.
  await page.getByText("שנה האחרונה", { exact: true }).first().click({ timeout: 2500 }).catch(() => {});
}

export async function fetchComparables(
  resolved: ResolvedSettlement,
  subject: SubjectFilter,
  monthsBack?: number
): Promise<FetchResult> {
  return enqueue(() => doFetch(resolved, subject, monthsBack));
}

async function doFetch(
  resolved: ResolvedSettlement,
  subject: SubjectFilter,
  monthsBack?: number
): Promise<FetchResult> {
  if (!getBrowser()?.isConnected()) await launchBrowser();
  const browser = getBrowser();
  if (!browser) throw new Error("browser unavailable");

  const settlementId = resolved.settlementId;
  const url = settlementDealsUrl(settlementId);
  const sourceUrl = url;
  const cutoff = isoMonthsAgo(monthsBack ?? config.monthsBack);

  let got403 = false;
  let pagesFetched = 0;
  let buffer: RawDeal[] | null = null;
  let totalRows: number | null = null;
  let yearApplied = false;

  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    // Hard overall budget: never start an attempt that could run past the worker
    // deadline (and so past the Vercel client timeout → 499). Return what we have.
    if (elapsed() >= WORKER_DEADLINE_MS) {
      log.warn(
        { settlementId, attempt, elapsedMs: elapsed() },
        "deal-data: worker deadline reached — returning what we have"
      );
      break;
    }

    const context = await browser.newContext({ locale: "he-IL", userAgent: UA });
    const page = await context.newPage();
    let phaseYear = false;

    page.on("response", async (res) => {
      const u = res.url();
      if (!u.includes("/deal-data")) return;
      if (res.status() === 403) {
        got403 = true; // user-limit — back off, no evasion
        return;
      }
      if (res.status() !== 200) return;
      try {
        const env = decodeDealData(await res.body());
        const items = extractItems(env);
        if (items.length) {
          buffer = items;
          totalRows = env?.data?.total_rows ?? totalRows;
          if (phaseYear) yearApplied = true;
        }
      } catch {
        /* keep waiting */
      }
    });

    try {
      // domcontentloaded (NOT networkidle): the nadlan SPA polls continuously and
      // never reaches networkidle, which made goto stall to its 60s timeout —
      // the root cause of the ~100s run. deal-data is detected via the response
      // interceptor + scroll regardless.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
      // Patient scroll — breaks the instant the interceptor fills buffer, and
      // stops at the overall deadline.
      for (let i = 0; i < SCROLL_ITERATIONS && !buffer && !got403 && elapsed() < WORKER_DEADLINE_MS; i++) {
        await page.mouse.wheel(0, 2500).catch(() => {});
        await sleep(SCROLL_DELAY_MS);
      }
      if (buffer && !got403) {
        pagesFetched = 1; // one 500-row buffer; the year filter only re-bounds it
        phaseYear = true;
        await driveYearFilter(page); // page signs its own request; we only click
        await sleep(2_000); // wait for the year-filtered re-fetch (meta.total_rows) — non-critical
      }
    } finally {
      await context.close().catch(() => {});
    }

    if (got403) {
      log.warn({ settlementId, attempt }, "deal-data 403 — stop + backoff (no evasion)");
      break;
    }
    if (buffer) break;

    log.info({ settlementId, attempt }, "no deal-data this attempt — retrying");
    // Tiny gap between attempts — NOT the 30s cooldown, which previously blocked
    // a single in-flight request and blew the budget. Skip it near the deadline.
    if (attempt < config.maxRetries && elapsed() < WORKER_DEADLINE_MS) await sleep(RETRY_GAP_MS);
  }

  if (!buffer) {
    return {
      comparables: [],
      settlement_sample: [],
      meta: {
        settlement_id: settlementId,
        settlement_name: resolved.settlementName,
        total_rows: null,
        year_filter_applied: false,
        window_truncated: false,
        oldest_covered: null,
        rooms_matched: 0,
        pages_fetched: 0,
        got_403: got403,
        source_url: sourceUrl,
      },
    };
  }

  const rows: RawDeal[] = buffer;
  const comps = rows
    .map((r) => toComparable(r, sourceUrl))
    .filter((c): c is NadlanComparable => c !== null);
  const within = comps.filter((c) => c.deal_date >= cutoff); // last 12 months
  const bufferMin = comps.reduce((m, c) => (c.deal_date < m ? c.deal_date : m), "9999");
  // buffer's oldest row is still newer than the cutoff → older 12mo deals exist
  // beyond our newest 500 (we don't click-walk them — Source-2 backfills).
  const window_truncated = bufferMin > cutoff;
  const oldest_covered = within.length
    ? within.reduce((m, c) => (c.deal_date < m ? c.deal_date : m), "9999")
    : null;

  const near = filterNearSubject(within, subject);

  return {
    comparables: near.comparables,
    settlement_sample: near.settlement_sample,
    meta: {
      settlement_id: settlementId,
      settlement_name: resolved.settlementName,
      total_rows: totalRows,
      year_filter_applied: yearApplied,
      window_truncated,
      oldest_covered,
      rooms_matched: near.rooms_matched,
      pages_fetched: pagesFetched,
      got_403: false,
      source_url: sourceUrl,
    },
  };
}
