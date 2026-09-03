import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { app } from "../app.js";
import { AskError, askGroq, compactProduct, GROQ_URL, NOT_SAID, SYSTEM_PROMPT } from "../ask/index.js";
import type { Product } from "../../shared/types.js";

const product: Product = {
  id: "p1",
  url: "https://www.brooklinen.com/products/luxe-core-sheet-set",
  canonicalUrl: "https://www.brooklinen.com/products/luxe-core-sheet-set",
  host: "www.brooklinen.com",
  brand: "Brooklinen",
  title: "Luxe Sateen Core Sheet Set",
  description: "Thread count: 480. Material: 100% long-staple cotton.",
  images: ["https://cdn.shopify.com/x.jpg"],
  price: { amount: 169, currency: "USD" },
  options: [{ name: "Size", values: ["Twin", "Queen"] }],
  variants: [
    { id: "1", title: "Twin", options: { Size: "Twin" }, price: { amount: 169, currency: "USD" }, available: true },
    { id: "2", title: "Queen", options: { Size: "Queen" }, price: { amount: 209, currency: "USD" }, available: false },
  ],
  specs: { "Thread count": "480" },
  availability: "in_stock",
  platform: "shopify",
  cart: { kind: "shopify_permalink", base: "https://www.brooklinen.com" },
  extractedAt: "2026-09-04T00:00:00.000Z",
};

const KEY = "gsk_test_secret_do_not_leak";
const savedKey = process.env.GROQ_API_KEY;
const savedModel = process.env.GROQ_MODEL;

beforeEach(() => {
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_MODEL;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = savedKey;
  if (savedModel === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = savedModel;
});

const post = (body: unknown) => app.request("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("POST /api/ask", () => {
  it("501 llm_not_configured without a key", async () => {
    const res = await post({ question: "Is the queen in stock?", product });
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "llm_not_configured" });
  });

  it("400 on an invalid body", async () => {
    process.env.GROQ_API_KEY = KEY;
    expect((await post({ question: "", product })).status).toBe(400);
    expect((await post({ question: "x" })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    const res = await post({ question: "x", product: { ...product, variants: [] } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
  });
});

describe("askGroq", () => {
  it("calls Groq with a strict grounding prompt and returns an llm answer", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ choices: [{ message: { content: "The Queen size is out of stock; the Twin is in stock at 169 USD." } }] }), { status: 200 });
    }) as typeof fetch;
    const res = await askGroq({ question: "Is the queen in stock?", product }, { fetchImpl, apiKey: KEY, model: "test-model" });
    expect(res).toEqual({ answer: "The Queen size is out of stock; the Twin is in stock at 169 USD.", grounded: true, mode: "llm" });
    expect(captured).not.toBeNull();
    const { url, init } = captured!;
    expect(url).toBe(GROQ_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("test-model");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(body.messages[0].content).toContain(NOT_SAID);
    expect(body.messages[0].content).toMatch(/ONLY the product JSON/);
    expect(body.messages[1].content).toContain("Is the queen in stock?");
    expect(body.messages[1].content).toContain('"Queen"');
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it("502 on provider error without echoing the provider body or the key", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), { status: 401 })) as typeof fetch;
    const err = await askGroq({ question: "q", product }, { fetchImpl, apiKey: KEY }).catch((e) => e as AskError);
    expect(err).toBeInstanceOf(AskError);
    expect((err as AskError).status).toBe(502);
    expect((err as AskError).message).not.toContain(KEY);
    expect((err as AskError).message).not.toContain("bad key");
  });

  it("504 on timeout", async () => {
    const fetchImpl = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const err = await askGroq({ question: "q", product }, { fetchImpl, apiKey: KEY, timeoutMs: 30 }).catch((e) => e as AskError);
    expect((err as AskError).status).toBe(504);
    expect((err as AskError).code).toBe("llm_timeout");
  });

  it("route returns 200 with the answer when configured", async () => {
    process.env.GROQ_API_KEY = KEY;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: NOT_SAID } }] }), { status: 200 })) as typeof fetch;
    try {
      const res = await post({ question: "Is it machine washable?", product });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ answer: NOT_SAID, grounded: true, mode: "llm" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("compactProduct drops image URLs and keeps what questions need", () => {
    const c = compactProduct(product) as Record<string, unknown>;
    expect(c.images).toBeUndefined();
    expect(c.imageCount).toBe(1);
    expect(c.specs).toEqual({ "Thread count": "480" });
    expect((c.variants as unknown[]).length).toBe(2);
  });
});
