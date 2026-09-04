/**
 * Rung "headless": render a JS-heavy or bot-walled page in Playwright Chromium and return the DOM HTML.
 *
 * - env HEADLESS_FALLBACK ("1" default) turns the rung on/off
 * - env PLAYWRIGHT_BROWSERS_PATH is honored by Playwright itself when set
 * - concurrency 1 (one page at a time), at most MAX_PENDING renders queued, networkidle capped at 12 s, hard timeout 20 s
 * - every request the page makes (navigations, XHR, iframes, redirects) goes back through the SSRF guard;
 *   non-https, private / link-local / loopback targets and WebSockets are refused. Service workers and downloads are off.
 * - `playwright` is imported lazily so the server starts fine when it is not installed
 */
import { BROWSER_UA } from "./fetch.js";
import { validateTargetUrl, type LookupFn } from "../security/ssrf.js";
import type { Browser } from "playwright";

export const HEADLESS_NETWORKIDLE_MS = 12_000;
export const HEADLESS_HARD_TIMEOUT_MS = 20_000;
/** Renders waiting for the single Chromium slot beyond this are refused instead of piling up. */
export const MAX_PENDING = 3;

const SKIPPED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

export function headlessEnabled(): boolean {
  return (process.env.HEADLESS_FALLBACK ?? "1") !== "0";
}

export interface RenderedPage {
  html: string;
  finalUrl: string;
  status: number | null;
  ms: number;
}

/**
 * Route decision for every request the rendered page makes. Pure so it can be tested without a browser.
 * - heavy assets (image / media / font) → false; we only need the DOM
 * - anything that is not https:// → false (http, ws, file, chrome:, data: never reach the network layer we trust)
 * - https → the same SSRF guard the fetch rung uses (host names, IP literals, DNS answers); a throw → false
 */
export async function shouldAllowHeadlessRequest(url: string, resourceType: string, lookup?: LookupFn): Promise<boolean> {
  if (SKIPPED_RESOURCE_TYPES.has(resourceType)) return false;
  if (!/^https:\/\//i.test(url)) return false;
  try {
    await validateTargetUrl(url, lookup);
    return true;
  } catch {
    return false;
  }
}

let browserPromise: Promise<Browser> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

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

/** Serialize renders: one page at a time keeps memory flat on a 2 GB box. Refuse when the wait line is already MAX_PENDING deep. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  if (pending >= MAX_PENDING) return Promise.reject(new Error("headless queue full"));
  pending++;
  const run = queue.then(fn, fn).finally(() => {
    pending--;
  });
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
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    // Every request (including page-initiated navigations and redirects) re-runs the SSRF guard; heavy assets are skipped.
    await context.route("**/*", async (route) => {
      const req = route.request();
      const allow = await shouldAllowHeadlessRequest(req.url(), req.resourceType());
      return allow ? route.continue() : route.abort("blockedbyclient");
    });
    // route() never sees WebSocket handshakes; close them at the socket level.
    await context.routeWebSocket("**", (ws) => ws.close());
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
