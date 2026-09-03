import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clearExtractCache, extractProduct } from "../extract/index.js";
import { detectBotChallenge } from "../extract/fetch.js";
import { shopifyTargetFromUrl } from "../extract/shopify.js";
import { mineSpecs, normalizeUrl } from "../extract/normalize.js";
import { lenientJsonParse } from "../extract/jsonld.js";

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
const SHOPIFY_JS = fixture("shopify-product.js.json");
const SHOPIFY_JSON = fixture("shopify-product.json");
const SKIMS = fixture("skims-jsonld.html");
const SIMPLE_JSONLD = fixture("jsonld-product-simple.html");
const OG_ONLY = fixture("og-only.html");
const AKAMAI = fixture("bot-challenge-akamai.html");

const lookup = async () => ["93.184.216.34"];

type Route = (url: string, init: RequestInit) => Response | undefined;
function fetchFor(route: Route) {
  const calls: { url: string; ua: string }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, ua: headers["User-Agent"] ?? "" });
    return route(url, init ?? {}) ?? new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const json = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/json" } });

const base = { lookup, headless: false as const, fresh: true };

beforeEach(() => clearExtractCache());

describe("rung: shopify", () => {
  it("reads the .js feed, converts cents, keeps live availability, builds a cart permalink", async () => {
    const { fetchImpl, calls } = fetchFor((url) => {
      if (url === "https://www.brooklinen.com/products/luxe-core-sheet-set.js") return json(SHOPIFY_JS);
      if (url === "https://www.brooklinen.com/meta.json") return json('{"currency":"USD","name":"Brooklinen"}');
      return undefined;
    });
    const r = await extractProduct("https://www.brooklinen.com/products/luxe-core-sheet-set?utm_source=x#top", { ...base, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("shopify");
    expect(r.product.platform).toBe("shopify");
    expect(r.product.cart).toEqual({ kind: "shopify_permalink", base: "https://www.brooklinen.com" });
    expect(r.product.url).toBe("https://www.brooklinen.com/products/luxe-core-sheet-set");
    expect(r.product.canonicalUrl).toBe("https://www.brooklinen.com/products/luxe-core-sheet-set");
    expect(r.product.host).toBe("www.brooklinen.com");
    expect(r.product.title).toBe("Luxe Sateen Core Sheet Set");
    expect(r.product.brand).toBe("Brooklinen");
    expect(r.product.variants).toHaveLength(6);
    const v0 = r.product.variants[0];
    expect(v0.id).toBe("43350202646618");
    expect(v0.title).toBe("White / Twin");
    expect(v0.options).toEqual({ Color: "White", Size: "Twin" });
    expect(v0.price).toEqual({ amount: 169, currency: "USD" });
    expect(v0.available).toBe(true);
    expect(v0.url).toContain("?variant=43350202646618");
    expect(r.product.availability).toBe("in_stock");
    expect(r.product.priceRange?.min.amount).toBe(169);
    expect(r.product.priceRange?.max.amount).toBeGreaterThan(169);
    expect(r.product.options.map((o) => o.name)).toEqual(["Color", "Size"]);
    expect(r.product.images.length).toBeGreaterThan(0);
    expect(r.product.images.every((i) => i.startsWith("https://"))).toBe(true);
    expect(r.product.description).not.toMatch(/<[a-z]/i);
    expect(r.product.description.length).toBeLessThanOrEqual(4000);
    expect(r.product.specs["Thread count"]).toBe("480");
    expect(r.product.specs["Material"]).toBe("100% long-staple cotton");
    expect(r.rungs.map((g) => g.name)).toEqual(["shopify"]);
    expect(r.rungs[0].ok).toBe(true);
    // never touched the HTML page: the feed was enough
    expect(calls.some((c) => c.url === "https://www.brooklinen.com/products/luxe-core-sheet-set")).toBe(false);
    expect(calls[0].ua).toMatch(/^AgentPDP\//);
  });

  it("falls back to the .json feed and reports unknown availability honestly", async () => {
    const { fetchImpl } = fetchFor((url) => {
      if (url.endsWith("/products/luxe-core-sheet-set.json")) return json(SHOPIFY_JSON);
      if (url.endsWith("/meta.json")) return json('{"currency":"USD"}');
      return undefined; // .js → 404
    });
    const r = await extractProduct("https://www.brooklinen.com/collections/sheets/products/luxe-core-sheet-set", { ...base, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("shopify");
    expect(r.product.variants).toHaveLength(4);
    expect(r.product.variants[0].price.amount).toBe(169);
    expect(r.product.variants.every((v) => v.available === null)).toBe(true);
    expect(r.product.availability).toBe("unknown");
    expect(r.warnings.join(" ")).toMatch(/availability unknown/);
  });

  it("detects Shopify from HTML markers + canonical when the URL has no /products/", async () => {
    const page = `<html><head><link rel="canonical" href="https://store.example.com/products/luxe-core-sheet-set"><script src="https://cdn.shopify.com/s/x.js"></script></head><body></body></html>`;
    const { fetchImpl } = fetchFor((url) => {
      if (url === "https://store.example.com/p/12345") return html(page);
      if (url === "https://store.example.com/products/luxe-core-sheet-set.js") return json(SHOPIFY_JS);
      if (url === "https://store.example.com/meta.json") return json('{"currency":"CAD"}');
      return undefined;
    });
    const r = await extractProduct("https://store.example.com/p/12345", { ...base, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("shopify");
    expect(r.product.price.currency).toBe("CAD");
    expect(r.rungs.map((g) => g.name)).toEqual(["fetch", "shopify"]);
  });

  it("parses handles from locale and collection prefixes", () => {
    expect(shopifyTargetFromUrl("https://skims.com/en-us/products/fits-everybody-bra")).toEqual({ origin: "https://skims.com", handle: "fits-everybody-bra" });
    expect(shopifyTargetFromUrl("https://x.com/collections/sale/products/thing-1?variant=2")).toEqual({ origin: "https://x.com", handle: "thing-1" });
    expect(shopifyTargetFromUrl("https://x.com/products/thing.json")).toEqual({ origin: "https://x.com", handle: "thing" });
    expect(shopifyTargetFromUrl("https://x.com/pages/about")).toBeNull();
  });
});

describe("rung: jsonld", () => {
  it("reads a real ProductGroup (SKIMS) with hasVariant, sizes, ILS prices and Shopify variant ids", async () => {
    const { fetchImpl } = fetchFor((url) => (url === "https://skims.com/en-il/products/fits-everybody-t-shirt-bra-onyx" ? html(SKIMS) : undefined));
    const r = await extractProduct("https://skims.com/en-il/products/fits-everybody-t-shirt-bra-onyx", { ...base, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("jsonld");
    expect(r.product.platform).toBe("unknown"); // not produced by the Shopify rung
    expect(r.product.brand).toBe("SKIMS");
    expect(r.product.title).toBe("FITS EVERYBODY T-SHIRT BRA | ONYX");
    expect(r.product.variants.length).toBeGreaterThan(5);
    expect(r.product.options[0].name).toBe("Size");
    expect(r.product.variants[0].options.Size).toBe("30 AA");
    expect(r.product.variants[0].price).toEqual({ amount: 165, currency: "ILS" });
    expect(r.product.variants[0].id).toMatch(/^\d{10,}$/); // from ?variant=
    expect(r.product.cart).toEqual({ kind: "shopify_permalink", base: "https://skims.com" });
    expect(["in_stock", "out_of_stock"]).toContain(r.product.availability);
    expect(r.rungs.map((g) => g.name)).toEqual(["shopify", "fetch", "jsonld"]);
    expect(r.rungs[0].ok).toBe(false); // feed 404s on the headless storefront
  });

  it("reads Product + AggregateOffer + nested offers from an @graph with sloppy JSON, ignores related-item lists", async () => {
    const { fetchImpl } = fetchFor((url) => (url.startsWith("https://shop.example-outdoor.com/p/ridge-trail-jacket/RTJ-100.html") ? html(SIMPLE_JSONLD) : undefined));
    const r = await extractProduct("https://shop.example-outdoor.com/p/ridge-trail-jacket/RTJ-100.html", { ...base, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("jsonld");
    expect(r.product.title).toBe("Ridge Trail Jacket");
    expect(r.product.brand).toBe("Example Outdoor Co");
    expect(r.product.id).toBe("RTJ-100");
    expect(r.product.variants.map((v) => v.id)).toEqual(["RTJ-100-S", "RTJ-100-M", "RTJ-100-L"]);
    expect(r.product.variants.map((v) => v.available)).toEqual([true, false, true]);
    expect(r.product.variants[2].price.amount).toBe(279);
    expect(r.product.variants[0].options).toEqual({ Size: "S", Color: "Moss" });
    expect(r.product.priceRange).toEqual({ min: { amount: 249, currency: "USD" }, max: { amount: 279, currency: "USD" } });
    expect(r.product.availability).toBe("in_stock");
    expect(r.product.images).toEqual(["https://images.example-outdoor.com/rtj-100/front.jpg", "https://images.example-outdoor.com/rtj-100/back.jpg"]);
    expect(r.product.specs["Waterproof rating"]).toBe("20,000 mm");
    expect(r.product.specs["Fit"]).toBe("Regular");
    expect(r.product.specs["Material"]).toBe("Recycled nylon");
    expect(r.product.specs["Weight"]).toBe("310 g"); // mined from the description
    expect(r.product.rating).toEqual({ value: 4.6, count: 128 });
    expect(r.product.description).toContain("three-layer shell");
    expect(r.product.cart).toEqual({ kind: "pdp_link" });
  });

  it("lenient parser handles trailing commas and comments", () => {
    expect(lenientJsonParse('<!-- x -->{"a":[1,2,],}')).toEqual({ a: [1, 2] });
    expect(lenientJsonParse("garbage")).toBeUndefined();
  });
});

describe("rung: og", () => {
  it("builds a single synthetic variant from OpenGraph product meta", async () => {
    const { fetchImpl } = fetchFor((url) => (url === "https://www.example-woodshop.com/product/cedar-bench/" ? html(OG_ONLY) : undefined));
    const r = await extractProduct("https://www.example-woodshop.com/product/cedar-bench/", { ...base, fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("og");
    expect(r.product.title).toBe("Cedar Bench");
    expect(r.product.brand).toBe("Example Woodshop");
    expect(r.product.variants).toHaveLength(1);
    expect(r.product.variants[0].id).toBe("WS-CB-48");
    expect(r.product.price).toEqual({ amount: 1250, currency: "USD" });
    expect(r.product.availability).toBe("in_stock");
    expect(r.product.images).toEqual([
      "https://www.example-woodshop.com/wp-content/uploads/cedar-bench-1.jpg",
      "https://www.example-woodshop.com/wp-content/uploads/cedar-bench-2.jpg",
    ]);
    expect(r.product.specs["Seat height"]).toBe("18 in.");
    expect(r.product.priceRange).toBeUndefined();
    expect(r.rungs.map((g) => `${g.name}:${g.ok}`)).toEqual(["fetch:true", "jsonld:false", "og:true"]);
  });
});

describe("ladder: failures, bot walls, headless", () => {
  it("retries with a browser UA on a bot wall and reports blocked_by_site when headless is off", async () => {
    const { fetchImpl, calls } = fetchFor(() => html(AKAMAI, 403));
    const r = await extractProduct("https://shop.lululemon.com/p/womens-leggings/Align-Pant-2/_/prod2020012", { ...base, fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("blocked_by_site");
    expect(r.error).toMatch(/Akamai/);
    expect(calls).toHaveLength(2);
    expect(calls[0].ua).toMatch(/^AgentPDP\//);
    expect(calls[1].ua).toMatch(/Chrome\//);
    expect(r.rungs.find((g) => g.name === "fetch")?.note).toMatch(/bot wall: Akamai/);
  });

  it("returns no_product for a page with nothing usable", async () => {
    const { fetchImpl } = fetchFor(() => html("<html><head><title>Hello</title></head><body>hi</body></html>"));
    const r = await extractProduct("https://blog.example.com/post", { ...base, fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("no_product");
    expect(r.rungs.map((g) => g.name)).toEqual(["fetch", "jsonld", "og", "headless"]);
  });

  it("blocks SSRF targets before any fetch", async () => {
    const { fetchImpl, calls } = fetchFor(() => html("x"));
    const r = await extractProduct("http://169.254.169.254/latest/meta-data/", { ...base, fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("ssrf_blocked");
    expect(calls).toHaveLength(0);
  });

  it("uses the headless renderer when the static HTML has no product, and flags it", async () => {
    const { fetchImpl } = fetchFor(() => html("<html><head><title>Loading…</title></head><body><div id=app></div></body></html>"));
    const render = async (url: string) => ({ html: SIMPLE_JSONLD, finalUrl: url, status: 200, ms: 5 });
    const r = await extractProduct("https://spa.example.com/p/ridge", { ...base, fetchImpl, headless: true, render });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("jsonld");
    expect(r.warnings).toContain("rendered with headless browser");
    expect(r.rungs.map((g) => `${g.name}:${g.ok}`)).toEqual(["fetch:true", "jsonld:false", "og:false", "headless:true", "jsonld:true"]);
  });

  it("reports no_product (not blocked) when the browser gets through a wall but the page has no product data", async () => {
    const { fetchImpl } = fetchFor(() => html(AKAMAI, 403));
    const render = async (url: string) => ({ html: "<html><head><title>Heavy Cotton Tee</title></head><body>" + "x".repeat(30_000) + "</body></html>", finalUrl: url, status: 200, ms: 5 });
    const r = await extractProduct("https://www.gildan.com/en-us/products/tee", { ...base, fetchImpl, headless: true, render });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("no_product");
    expect(r.error).toMatch(/even after rendering/);
    expect(r.rungs.find((g) => g.name === "headless")?.ok).toBe(true);
  });

  it("maps a fetch-level timeout to code timeout", async () => {
    const fetchImpl = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch;
    // Use a non-Shopify URL so the first request is the HTML page.
    const r = await extractProduct("https://slow.example.com/item/1", { ...base, fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("timeout");
  }, 15_000);
});

describe("cache", () => {
  it("serves the second call from cache within TTL and bypasses with fresh", async () => {
    let hits = 0;
    const { fetchImpl } = fetchFor((url) => {
      hits++;
      if (url.endsWith(".js")) return json(SHOPIFY_JS);
      if (url.endsWith("/meta.json")) return json('{"currency":"USD"}');
      return undefined;
    });
    const url = "https://www.brooklinen.com/products/luxe-core-sheet-set";
    const a = await extractProduct(url, { lookup, headless: false, fetchImpl });
    expect(a.ok && a.cached).toBe(false);
    const after = hits;
    const b = await extractProduct(url + "?utm_campaign=z", { lookup, headless: false, fetchImpl });
    expect(b.ok && b.cached).toBe(true);
    expect(hits).toBe(after);
    const c = await extractProduct(url, { lookup, headless: false, fetchImpl, fresh: true });
    expect(c.ok && c.cached).toBe(false);
    expect(hits).toBeGreaterThan(after);
  });
});

describe("helpers", () => {
  it("normalizeUrl strips tracking params and hashes, keeps variant", () => {
    expect(normalizeUrl("http://x.com/products/a?variant=1&utm_source=li&fbclid=2#gallery")).toBe("https://x.com/products/a?variant=1");
  });
  it("mineSpecs is conservative", () => {
    const specs = mineSpecs("Material: 100% cotton\nhttps://x.com: nope\nNote: something\n- Weight: 2 lb\nToo long a key that goes on and on and on and on forever: v");
    expect(specs).toEqual({ Material: "100% cotton", Weight: "2 lb" });
  });
  it("detectBotChallenge recognizes vendors", () => {
    expect(detectBotChallenge(AKAMAI, 403)).toBe("Akamai");
    expect(detectBotChallenge("<title>Just a moment...</title><script src=/cdn-cgi/challenge-platform/x></script>", 403)).toBe("Cloudflare");
    expect(detectBotChallenge('<script src="https://captcha-delivery.com/captcha/"></script>', 403)).toBe("DataDome");
    expect(detectBotChallenge("<html>" + "x".repeat(50_000) + "_abck</html>", 200)).toBeNull(); // real page mentioning Akamai's cookie
  });
});
