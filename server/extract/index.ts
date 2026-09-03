/**
 * extractProduct(url): the extraction ladder.
 *
 *   shopify  → /products/<handle>.js (.json alternate) when the URL or HTML says Shopify
 *   jsonld   → schema.org Product / ProductGroup in the fetched HTML
 *   og       → OpenGraph / product:* meta / microdata
 *   headless → render in Chromium, then rerun shopify-markers → jsonld → og on the DOM
 *
 * Stops at the first rung that yields a product. Every rung tried is recorded with its duration for /api/extract/debug.
 */
import type { ExtractErrorCode, ExtractResult, ExtractSource } from "../../shared/types.js";
import { GuardError, validateTargetUrl, type LookupFn } from "../security/ssrf.js";
import { TtlCache } from "./cache.js";
import { safeFetch, type SafeFetchResult } from "./fetch.js";
import { headlessEnabled, renderPage } from "./headless.js";
import { parseDoc } from "./html.js";
import { parseJsonLd } from "./jsonld.js";
import { normalizeProduct, normalizeUrl } from "./normalize.js";
import { parseOg } from "./og.js";
import { currencyFromMeta, feedUrls, looksLikeJson, parseShopifyFeed, shopifyTargetFromHtml, shopifyTargetFromUrl, type ShopifyTarget } from "./shopify.js";
import type { ExtractDebugResult, ParsedProduct, Rung } from "./types.js";

export interface ExtractDeps {
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
  /** override for tests; defaults to Playwright */
  render?: typeof renderPage;
  headless?: boolean;
  now?: () => number;
}

export interface ExtractOptions extends ExtractDeps {
  fresh?: boolean;
}

const cache = new TtlCache<Extract<ExtractResult, { ok: true }>>();
let defaults: ExtractDeps = {};

/** Test seam: inject fetch / DNS / render implementations for the whole module. */
export function configureExtractor(deps: ExtractDeps): void {
  defaults = deps;
}

export function clearExtractCache(): void {
  cache.clear();
}

export async function extractProduct(input: string, opts: ExtractOptions = {}): Promise<ExtractDebugResult> {
  const deps = { ...defaults, ...opts };
  const rungs: Rung[] = [];
  const started = Date.now();
  const fail = (code: ExtractErrorCode, error: string): ExtractDebugResult => ({ ok: false, code, error, rungs });

  // 1. Validate + normalize
  let target: URL;
  try {
    target = (await validateTargetUrl(input, deps.lookup)).url;
  } catch (err) {
    if (err instanceof GuardError) return fail(err.code, err.message);
    return fail("invalid_url", (err as Error).message);
  }
  const key = normalizeUrl(target.href);

  // 2. Cache
  if (!opts.fresh) {
    const hit = cache.get(key);
    if (hit) return { ...hit, cached: true, rungs: [{ name: "fetch", ok: true, ms: 0, note: "cache hit" }] };
  }

  const fetchOpts = { fetchImpl: deps.fetchImpl, lookup: deps.lookup };
  const finish = (parsed: ParsedProduct, source: ExtractSource, finalUrl: string, extraWarnings: string[] = []): ExtractDebugResult => {
    const moved = redirectNote(key, finalUrl);
    if (moved) extraWarnings = [...extraWarnings, moved];
    const { product, warnings } = normalizeProduct(parsed, { inputUrl: key, finalUrl, source });
    const result: Extract<ExtractResult, { ok: true }> = { ok: true, source, product, warnings: [...warnings, ...extraWarnings], fetchedMs: Date.now() - started, cached: false };
    cache.set(key, result);
    return { ...result, rungs };
  };

  // 3. Rung: shopify by URL
  const urlTarget = shopifyTargetFromUrl(key);
  if (urlTarget) {
    const r = await shopifyRung(urlTarget, key, fetchOpts);
    rungs.push(r.rung);
    if (r.parsed) return finish(r.parsed, "shopify", r.parsed.canonicalUrl ?? key);
  }

  // 4. Fetch the HTML page
  const t0 = Date.now();
  let page: SafeFetchResult | null = null;
  let fetchError: GuardError | null = null;
  try {
    page = await safeFetch(key, fetchOpts);
    rungs.push({
      name: "fetch",
      ok: page.status < 400 && !page.botChallenge,
      ms: page.ms,
      note: `HTTP ${page.status}${page.redirects ? ` after ${page.redirects} redirect(s)` : ""}, ${page.text.length} chars, UA attempt ${page.attempts}${page.botChallenge ? `, bot wall: ${page.botChallenge}` : ""}`,
    });
  } catch (err) {
    fetchError = err instanceof GuardError ? err : new GuardError("fetch_failed", (err as Error).message);
    rungs.push({ name: "fetch", ok: false, ms: Date.now() - t0, note: `${fetchError.code}: ${fetchError.message}` });
    if (fetchError.code === "ssrf_blocked" || fetchError.code === "invalid_url") return fail(fetchError.code, fetchError.message);
  }

  const usable = page && page.status < 400 && !page.botChallenge && page.text.length > 0;
  let blockedNote: string | null = null;
  if (page && (page.botChallenge || page.status === 403 || page.status === 429 || page.status === 503)) {
    blockedNote = page.botChallenge ? `bot wall (${page.botChallenge}), HTTP ${page.status}` : `HTTP ${page.status}`;
  }

  if (usable && page) {
    const out = await parseHtmlRungs(page.text, page.finalUrl, key, rungs, fetchOpts, urlTarget ? null : shopifyTargetFromHtml(page.text, page.finalUrl));
    if (out) return finish(out.parsed, out.source, page.finalUrl);
  }

  // 5. Rung: headless (JS-rendered or bot-walled)
  const useHeadless = deps.headless ?? headlessEnabled();
  if (useHeadless) {
    const t1 = Date.now();
    try {
      const rendered = await (deps.render ?? renderPage)(key);
      const walled = rendered.html.length < 20_000 && /Access Denied|Just a moment|verify you are a human|captcha/i.test(rendered.html);
      rungs.push({ name: "headless", ok: !walled, ms: rendered.ms, note: `rendered ${rendered.html.length} chars, HTTP ${rendered.status ?? "?"}, final ${rendered.finalUrl}${walled ? ", still a bot wall" : ""}` });
      if (!walled) {
        blockedNote = null; // the browser got a real page; whatever happens next is a data problem, not a wall
        const out = await parseHtmlRungs(rendered.html, rendered.finalUrl, key, rungs, fetchOpts, shopifyTargetFromHtml(rendered.html, rendered.finalUrl));
        if (out) return finish(out.parsed, out.source, rendered.finalUrl, ["rendered with headless browser"]);
      } else blockedNote = blockedNote ?? "bot wall (headless)";
    } catch (err) {
      rungs.push({ name: "headless", ok: false, ms: Date.now() - t1, note: (err as Error).message.split("\n")[0].slice(0, 200) });
    }
  } else {
    rungs.push({ name: "headless", ok: false, ms: 0, note: "disabled (HEADLESS_FALLBACK=0)" });
  }

  // 6. Nothing worked: say why. A page the browser rendered fine is a data problem, not a transport problem.
  const rendered = rungs.some((r) => r.name === "headless" && r.ok);
  if (!rendered) {
    if (fetchError && !page) return fail(fetchError.code, fetchError.message);
    if (blockedNote) return fail("blocked_by_site", `The site refused automated access (${blockedNote}).`);
    if (page && page.status >= 400) return fail("fetch_failed", `The page returned HTTP ${page.status}.`);
  }
  return fail("no_product", `No product data found${rendered ? " even after rendering in a browser" : ""}: no Shopify feed, no schema.org Product JSON-LD, no OpenGraph product meta.`);
}

interface FetchOpts {
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
}

async function shopifyRung(target: ShopifyTarget, pageUrl: string, fetchOpts: FetchOpts): Promise<{ parsed: ParsedProduct | null; rung: Rung }> {
  const t0 = Date.now();
  const urls = feedUrls(target, pageUrl);
  const notes: string[] = [];
  const metaPromise = safeFetch(`${target.origin}/meta.json`, { ...fetchOpts, accept: "json", timeoutMs: 5000 }).catch(() => null);
  for (const url of [...urls.js, ...urls.json]) {
    let res: SafeFetchResult;
    try {
      res = await safeFetch(url, { ...fetchOpts, accept: "json" });
    } catch (err) {
      const e = err as GuardError;
      notes.push(`${shortPath(url)} ${e.code ?? "error"}`);
      continue;
    }
    if (res.status !== 200 || !looksLikeJson(res)) {
      notes.push(`${shortPath(url)} HTTP ${res.status}${res.botChallenge ? ` (${res.botChallenge})` : looksLikeJson(res) ? "" : " (not JSON)"}`);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      notes.push(`${shortPath(url)} unparseable JSON`);
      continue;
    }
    const meta = await metaPromise;
    const storeCurrency = currencyFromMeta(meta && meta.status === 200 ? meta.text : undefined);
    const parsed = parseShopifyFeed(json, target, { storeCurrency, pageUrl });
    if (!parsed) {
      notes.push(`${shortPath(url)} JSON without a product`);
      continue;
    }
    if (!storeCurrency) parsed.warnings.push("store currency not exposed via /meta.json");
    if (!/^\/products\//.test(new URL(pageUrl).pathname)) {
      parsed.warnings.push("store serves localized URLs; the cart permalink may geo-redirect to the shopper's market");
    }
    return {
      parsed,
      rung: { name: "shopify", ok: true, ms: Date.now() - t0, note: `${shortPath(url)} → ${parsed.variants.length} variants${storeCurrency ? `, ${storeCurrency} via meta.json` : ""}` },
    };
  }
  return { parsed: null, rung: { name: "shopify", ok: false, ms: Date.now() - t0, note: notes.join("; ") || "no feed" } };
}

async function parseHtmlRungs(
  html: string,
  finalUrl: string,
  pageUrl: string,
  rungs: Rung[],
  fetchOpts: FetchOpts,
  htmlShopify: ShopifyTarget | null,
): Promise<{ parsed: ParsedProduct; source: ExtractSource } | null> {
  if (htmlShopify && !rungs.some((r) => r.name === "shopify")) {
    const r = await shopifyRung(htmlShopify, finalUrl, fetchOpts);
    rungs.push({ ...r.rung, note: `via HTML markers: ${r.rung.note}` });
    if (r.parsed) return { parsed: r.parsed, source: "shopify" };
  }
  const doc = parseDoc(html);

  let t = Date.now();
  try {
    const parsed = parseJsonLd(html, finalUrl, doc);
    if (parsed) {
      rungs.push({ name: "jsonld", ok: true, ms: Date.now() - t, note: `${parsed.variants.length} variant(s)${parsed.brand ? `, brand ${parsed.brand}` : ""}` });
      return { parsed, source: "jsonld" };
    }
    rungs.push({ name: "jsonld", ok: false, ms: Date.now() - t, note: /application\/ld\+json/i.test(html) ? "ld+json present but no Product node" : "no ld+json blocks" });
  } catch (err) {
    rungs.push({ name: "jsonld", ok: false, ms: Date.now() - t, note: `parser error: ${(err as Error).message.slice(0, 120)}` });
  }

  t = Date.now();
  try {
    const parsed = parseOg(html, finalUrl, doc);
    if (parsed) {
      rungs.push({ name: "og", ok: true, ms: Date.now() - t, note: `price ${parsed.variants[0]?.price ?? "?"} ${parsed.currency ?? ""}`.trim() });
      return { parsed, source: "og" };
    }
    rungs.push({ name: "og", ok: false, ms: Date.now() - t, note: /og:title|<title>/i.test(html) ? "title found but no price meta" : "no og / microdata" });
  } catch (err) {
    rungs.push({ name: "og", ok: false, ms: Date.now() - t, note: `parser error: ${(err as Error).message.slice(0, 120)}` });
  }
  void pageUrl;
  return null;
}

/** A geo / locale redirect means prices and availability reflect the server's region, not the shopper's. Say so. */
function redirectNote(inputUrl: string, finalUrl: string): string | null {
  try {
    const a = new URL(inputUrl);
    const b = new URL(finalUrl);
    if (a.host === b.host && a.pathname === b.pathname) return null;
    const locale = /^\/[a-z]{2}(-[a-z]{2})?\//i.test(b.pathname) && !/^\/[a-z]{2}(-[a-z]{2})?\//i.test(a.pathname);
    return locale
      ? `page redirected to a localized URL (${b.pathname.split("/")[1]}); prices and availability reflect that market, not necessarily the shopper's`
      : `page redirected to ${b.href}`;
  } catch {
    return null;
  }
}

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\//i, "…/");
  } catch {
    return url;
  }
}

/** Strip debug info for the public route. */
export function publicResult(r: ExtractDebugResult): ExtractResult {
  const { rungs: _r, ...rest } = r;
  return rest as ExtractResult;
}

export function statusFor(r: ExtractResult): 200 | 400 | 403 | 422 | 502 | 504 {
  if (r.ok) return 200;
  switch (r.code) {
    case "invalid_url":
      return 400;
    case "ssrf_blocked":
      return 403;
    case "no_product":
      return 422;
    case "timeout":
      return 504;
    default:
      return 502; // fetch_failed | blocked_by_site | too_large
  }
}
