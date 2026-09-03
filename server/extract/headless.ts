/**
 * Rung "headless": render a JS-heavy or bot-walled page in Playwright Chromium and return the DOM HTML.
 *
 * - env HEADLESS_FALLBACK ("1" default) turns the rung on/off
 * - env PLAYWRIGHT_BROWSERS_PATH is honored by Playwright itself when set
 * - concurrency 1 (one page at a time), networkidle capped at 12 s, hard timeout 20 s
 * - `playwright` is imported lazily so the server starts fine when it is not installed
 */
import { BROWSER_UA } from "./fetch.js";
import type { Browser } from "playwright";

export const HEADLESS_NETWORKIDLE_MS = 12_000;
export const HEADLESS_HARD_TIMEOUT_MS = 20_000;

export function headlessEnabled(): boolean {
  return (process.env.HEADLESS_FALLBACK ?? "1") !== "0";
}

export interface RenderedPage {
  html: string;
  finalUrl: string;
  status: number | null;
  ms: number;
}

let browserPromise: Promise<Browser> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const pw = await import("playwright").catch(() => null);
      if (!pw) throw new Error("playwright is not installed (npm i -D @playwright/test && npx playwright install chromium)");
      const browser = await pw.chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    })();
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

/** Serialize renders: one page at a time keeps memory flat on a 2 GB box. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export function renderPage(url: string): Promise<RenderedPage> {
  return serialized(async () => {
    const started = Date.now();
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: BROWSER_UA,
      locale: "en-US",
      viewport: { width: 1366, height: 900 },
      javaScriptEnabled: true,
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    // Skip heavy assets; we only need the DOM.
    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font") return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    const hardTimer = setTimeout(() => {
      context.close().catch(() => {});
    }, HEADLESS_HARD_TIMEOUT_MS);
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: HEADLESS_NETWORKIDLE_MS });
      await page.waitForLoadState("networkidle", { timeout: HEADLESS_NETWORKIDLE_MS }).catch(() => {});
      // Give late JSON-LD injectors a moment; cheap insurance for SPA storefronts.
      await page.waitForSelector('script[type="application/ld+json"]', { timeout: 1500 }).catch(() => {});
      const html = await page.content();
      return { html, finalUrl: page.url(), status: response?.status() ?? null, ms: Date.now() - started };
    } finally {
      clearTimeout(hardTimer);
      await context.close().catch(() => {});
    }
  });
}

/** Close the shared browser (tests / graceful shutdown). */
export async function closeBrowser(): Promise<void> {
  const b = browserPromise;
  browserPromise = null;
  if (b) await (await b.catch(() => null))?.close().catch(() => {});
}
