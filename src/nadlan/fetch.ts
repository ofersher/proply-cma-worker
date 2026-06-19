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

// PATIENCE budget. On a non-blocked IL IP the goal is rows>0, not a fast empty
// return. domcontentloaded for a fast, deterministic nav (networkidle stalls goto
// to 60s on this SPA), THEN wait up to DEAL_DATA_WAIT_MS per attempt for the SITE
// to fire its own deal-data — it first bootstraps + runs grecaptcha + token-verify
// (15-40s), so a short scroll returned before it ever fired. We gently scroll to
// provoke and poll the interceptor-decoded buffer. Self-caps at WORKER_DEADLINE_MS
// so it still returns before the caller's CMA_WORKER_TIMEOUT_MS (raise that to
// ~100s on the Vercel side to match). config.fetchDelayMs / config.cooldownMs unused.
const WORKER_DEADLINE_MS = 95_000; // hard overall budget across all attempts
const DEAL_DATA_WAIT_MS = 45_000; // per-attempt patient wait for the deal-data XHR
const SCROLL_DELAY_MS = 2000; // gentle human-like scroll cadence while waiting
const RETRY_GAP_MS = 2000; // tiny gap between attempts

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
  let tokenVerify = "(none)"; // diagnostic — did the SITE's reCAPTCHA token pass from this egress IP?
  let capturedRows = 0; // diagnostic — rows in the captured buffer (avoids TS closure-narrowing on `buffer`)

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

    // ── TEMP DIAG (remove after VPS bootstrap diagnosis) ──────────────────────
    // Capture what the page actually DOES on this Chromium: console output, page
    // exceptions, failed requests, and every api.nadlan.gov.il call (was the
    // deal-data XHR ever even ISSUED?). Read-only — no behaviour change.
    const dApi: string[] = []; // api.nadlan.gov.il requests/responses, method+status
    const dConsole: string[] = [];
    const dPageErr: string[] = [];
    const dFailed: string[] = [];
    let dDealDataIssued = false;
    page.on("console", (m) => {
      if (dConsole.length < 50) dConsole.push(`${m.type()}: ${m.text()}`.slice(0, 300));
    });
    page.on("pageerror", (e) => {
      if (dPageErr.length < 25) dPageErr.push(String(e?.message ?? e).slice(0, 300));
    });
    page.on("requestfailed", (req) => {
      if (dFailed.length < 50)
        dFailed.push(`${req.method()} ${req.url().slice(0, 120)} — ${req.failure()?.errorText ?? "?"}`);
    });
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("nadlan.gov.il") && /\/(deal-data|deal-info|token-verify|recaptcha|enterprise)/i.test(u)) {
        if (u.includes("/deal-data")) dDealDataIssued = true;
        log.info({ attempt, method: req.method(), url: u.slice(0, 160) }, "DIAG api request ISSUED");
      }
    });
    page.on("response", (res) => {
      const u = res.url();
      if (u.includes("nadlan.gov.il") && /\/(deal-data|deal-info|token-verify|recaptcha|enterprise)/i.test(u)) {
        if (dApi.length < 60) dApi.push(`${res.request().method()} ${res.status()} ${u.slice(0, 120)}`);
      }
    });
    // ──────────────────────────────────────────────────────────────────────────

    page.on("response", async (res) => {
      const u = res.url();
      // Diagnostic: the SITE's own grecaptcha token is verified here. 200/ok ⇒ the
      // egress IP scored fine and deal-data will follow; 400/fail ⇒ reCAPTCHA
      // rejected this IP (datacenter low score) and deal-data never fires. We only
      // READ this — we never mint/recycle the token.
      if (u.includes("/token-verify")) {
        try {
          const ok = (JSON.parse((await res.body()).toString("utf8")) as { ok?: unknown }).ok;
          tokenVerify = `${res.status()}:${ok ? "ok" : "fail"}`;
        } catch {
          tokenVerify = String(res.status());
        }
        log.info({ settlementId, attempt, tokenVerify }, "token-verify");
        return;
      }
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
          capturedRows = items.length;
          totalRows = env?.data?.total_rows ?? totalRows;
          if (phaseYear) yearApplied = true;
          log.info({ settlementId, attempt, rows: items.length, phaseYear }, "deal-data captured");
        }
      } catch {
        /* keep waiting */
      }
    });

    try {
      // domcontentloaded for a fast, deterministic nav (networkidle stalls goto to
      // its 60s timeout on this chatty SPA).
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});

      // PATIENTLY wait for the SITE to fire its own deal-data (after it bootstraps
      // + runs grecaptcha + token-verify), gently scrolling like a human to provoke
      // it. We poll the interceptor-decoded buffer — equivalent to
      // waitForResponse(/deal-data) but via our decode path, so an empty 200 never
      // ends the wait early. We never craft the request; the page fires & signs it.
      const attemptDeadline = Date.now() + DEAL_DATA_WAIT_MS;
      while (!buffer && !got403 && Date.now() < attemptDeadline && elapsed() < WORKER_DEADLINE_MS) {
        await page.mouse.wheel(0, 2000).catch(() => {});
        await sleep(SCROLL_DELAY_MS);
      }

      // ── TEMP DIAG snapshot — what did the SPA actually render here? ──────────
      // Did the real nadlan app mount, or a blank/error/interstitial page? Is
      // grecaptcha present? Did the browser functionally render (WebGL, fonts)?
      try {
        const snap = await page
          .evaluate(() => {
            const txt = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
            let webgl = false;
            try {
              webgl = !!document.createElement("canvas").getContext("webgl");
            } catch {
              /* no webgl */
            }
            const w = window as unknown as { grecaptcha?: { enterprise?: unknown } };
            return {
              url: location.href,
              title: document.title,
              readyState: document.readyState,
              bodyTextLen: txt.length,
              bodyTextHead: txt.slice(0, 500), // detects "browser not supported"/JS-off notices
              scripts: document.querySelectorAll("script").length,
              filterBtns: document.querySelectorAll("button.filterBtn").length, // our deals-UI anchor
              hasReactRoot: !!document.querySelector("#root, #app, [data-reactroot], main"),
              hasGrecaptcha: !!w.grecaptcha,
              hasGrecaptchaEnterprise: !!(w.grecaptcha && w.grecaptcha.enterprise),
              webdriver: navigator.webdriver,
              ua: navigator.userAgent,
              lang: navigator.language,
              webgl,
            };
          })
          .catch((e) => ({ evalError: String(e) }));
        log.info({ attempt, ...snap }, "DIAG page snapshot");
      } catch (e) {
        log.warn({ attempt, err: String(e) }, "DIAG snapshot failed");
      }
      log.info(
        {
          attempt,
          dealDataIssued: dDealDataIssued,
          apiCalls: dApi,
          failedReqs: dFailed.slice(0, 25),
          pageErrors: dPageErr,
          consoleMsgs: dConsole.slice(0, 30),
        },
        "DIAG attempt wrap"
      );
      // Save a screenshot to /tmp so you can scp it off the VPS if the text is unclear.
      await page.screenshot({ path: `/tmp/nadlan-diag-attempt${attempt}.png` }).catch(() => {});
      // ────────────────────────────────────────────────────────────────────────

      // Year filter is a REFINEMENT after the first buffer is captured — it fires a
      // second deal-data the interceptor decodes (updates meta.total_rows). If it's
      // slow/empty the FIRST buffer is kept (the handler only overwrites buffer with
      // a non-empty set), so a slow refinement never loses the captured deals.
      if (buffer && !got403) {
        pagesFetched = 1;
        phaseYear = true;
        await driveYearFilter(page); // page signs its own request; we only click
        await sleep(3_000);
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

  // Diagnostic summary — Railway logs show whether the (proxied) egress IP made
  // the SITE's reCAPTCHA pass and whether the deal-data buffer was captured.
  log.info(
    {
      settlementId,
      proxied: Boolean(config.proxyServer),
      tokenVerify,
      dealDataFired: capturedRows > 0,
      rows: capturedRows,
      got403,
      elapsedMs: elapsed(),
    },
    "deal-data: doFetch summary"
  );

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
