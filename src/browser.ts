import { chromium, type Browser } from "playwright";
import { log } from "./log.js";

/**
 * Single warm HEADED Chromium for the whole process.
 *
 * Headed is MANDATORY: nadlan's reCAPTCHA v3 backend rejects headless tokens
 * (PH1 spike — headless 0/3 token-verify, headed 5/5). In the container the
 * "headed" browser runs against an xvfb virtual display (see Dockerfile CMD),
 * so no real screen is needed.
 *
 * We NEVER forge tokens, solve captchas, or game the reCAPTCHA score — later
 * code only drives the site's own UI so the page signs its own requests.
 */

let browser: Browser | null = null;

export async function launchBrowser(): Promise<void> {
  if (browser?.isConnected()) return;
  browser = await chromium.launch({
    headless: false,
    // --no-sandbox is required to run Chromium as root in the container.
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  browser.on("disconnected", () => {
    browser = null;
    log.warn("browser disconnected");
  });
  log.info("browser launched (headed, under xvfb)");
}

export function isBrowserUp(): boolean {
  return browser !== null && browser.isConnected();
}

export function getBrowser(): Browser | null {
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (!browser) return;
  await browser.close().catch(() => {});
  browser = null;
}
