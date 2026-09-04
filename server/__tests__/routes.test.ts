import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { app, ASK_BODY_LIMIT_BYTES, RATE_LIMIT_EXTRACT, resetRateLimits } from "../app.js";
import { clearExtractCache, configureExtractor } from "../extract/index.js";

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
const SHOPIFY_JS = fixture("shopify-product.js.json");
const OG_ONLY = fixture("og-only.html");
const AKAMAI = fixture("bot-challenge-akamai.html");

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const json = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/json" } });

const fetchImpl = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url === "https://www.brooklinen.com/products/luxe-core-sheet-set.js") return json(SHOPIFY_JS);
  if (url === "https://www.brooklinen.com/meta.json") return json('{"currency":"USD"}');
  if (url === "https://www.example-woodshop.com/product/cedar-bench/") return html(OG_ONLY);
  if (url.startsWith("https://shop.lululemon.com/")) return html(AKAMAI, 403);
  if (url.startsWith("https://down.example.com/")) throw new Error("ECONNRESET");
  return html("<html><head><title>nothing</title></head><body></body></html>");
}) as typeof fetch;

beforeAll(() => configureExtractor({ fetchImpl, lookup: async () => ["93.184.216.34"], headless: false }));
afterAll(() => configureExtractor({}));
beforeEach(() => {
  clearExtractCache();
  resetRateLimits();
});

describe("GET /api/extract", () => {
  it("400 without url", async () => {
    const res = await app.request("/api/extract");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: "invalid_url" });
  });

  it("400 invalid url", async () => {
    const res = await app.request("/api/extract?url=" + encodeURIComponent("not a url at all"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_url");
  });

  it("403 ssrf", async () => {
    for (const u of ["http://127.0.0.1:8787/healthz", "https://localhost/", "https://[::1]/", "https://10.0.0.1/"]) {
      const res = await app.request("/api/extract?url=" + encodeURIComponent(u));
      expect(res.status, u).toBe(403);
      expect((await res.json()).code).toBe("ssrf_blocked");
    }
  });

  it("200 ok with a Product and no debug rungs", async () => {
    const res = await app.request("/api/extract?url=" + encodeURIComponent("https://www.brooklinen.com/products/luxe-core-sheet-set"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.source).toBe("shopify");
    expect(body.product.variants.length).toBe(6);
    expect(body.cached).toBe(false);
    expect(body.rungs).toBeUndefined();
    expect(typeof body.fetchedMs).toBe("number");
    expect(Array.isArray(body.warnings)).toBe(true);

    const again = await app.request("/api/extract?url=" + encodeURIComponent("https://www.brooklinen.com/products/luxe-core-sheet-set"));
    expect((await again.json()).cached).toBe(true);
    const fresh = await app.request("/api/extract?fresh=1&url=" + encodeURIComponent("https://www.brooklinen.com/products/luxe-core-sheet-set"));
    expect((await fresh.json()).cached).toBe(false);
  });

  it("200 via og rung", async () => {
    const res = await app.request("/api/extract?url=" + encodeURIComponent("https://www.example-woodshop.com/product/cedar-bench/"));
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe("og");
  });

  it("422 no_product", async () => {
    const res = await app.request("/api/extract?url=" + encodeURIComponent("https://blog.example.com/post/1"));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("no_product");
  });

  it("502 blocked_by_site", async () => {
    const res = await app.request("/api/extract?url=" + encodeURIComponent("https://shop.lululemon.com/p/x/_/prod1"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("blocked_by_site");
    expect(body.error).toMatch(/Akamai/);
  });

  it("502 fetch_failed", async () => {
    const res = await app.request("/api/extract?url=" + encodeURIComponent("https://down.example.com/p/1"));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("fetch_failed");
  });
});

describe("GET /api/extract/debug", () => {
  it("includes rungs with name/ok/ms/note", async () => {
    const res = await app.request("/api/extract/debug?url=" + encodeURIComponent("https://www.example-woodshop.com/product/cedar-bench/"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rungs.map((r: { name: string }) => r.name)).toEqual(["fetch", "jsonld", "og"]);
    for (const r of body.rungs) {
      expect(typeof r.ok).toBe("boolean");
      expect(typeof r.ms).toBe("number");
      expect(typeof r.note).toBe("string");
    }
  });
  it("400 without url", async () => {
    const res = await app.request("/api/extract/debug");
    expect(res.status).toBe(400);
    expect((await res.json()).rungs).toEqual([]);
  });
});

describe("abuse limits", () => {
  it("61st /api/extract request within a minute from one x-real-ip is 429; other addresses are unaffected", async () => {
    const from = (ip: string, path = "/api/extract") => app.request(path, { headers: { "x-real-ip": ip } });
    for (let i = 0; i < RATE_LIMIT_EXTRACT; i++) {
      const res = await from("203.0.113.9");
      expect(res.status, `request ${i + 1}`).toBe(400); // no ?url=, but counted
    }
    const limited = await from("203.0.113.9");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ ok: false, code: "rate_limited", error: "Too many requests; try again in a minute." });
    // the debug endpoint shares the same bucket
    expect((await from("203.0.113.9", "/api/extract/debug")).status).toBe(429);
    expect((await from("203.0.113.10")).status).toBe(400);
    expect((await app.request("/api/extract")).status).toBe(400);
  });

  it("ask body over the limit is 413 before the route runs", async () => {
    const big = JSON.stringify({ question: "q", product: { title: "x".repeat(ASK_BODY_LIMIT_BYTES + 1024) } });
    const res = await app.request("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: big });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, code: "payload_too_large" });
    const declared = await app.request("/api/ask", { method: "POST", headers: { "content-type": "application/json", "content-length": String(ASK_BODY_LIMIT_BYTES + 1) }, body: "{}" });
    expect(declared.status).toBe(413);
  });
});
