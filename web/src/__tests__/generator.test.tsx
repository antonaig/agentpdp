// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { TOOL_NAMES, type ExtractResult } from "@shared/types";
import { GeneratorPage } from "@/pages/Generator";
import { normalizeProductUrl } from "@/components/generator/validate";
import { EXAMPLE_URLS } from "@/components/generator/examples";
import { urlToPagePath } from "@/lib/api";
import { registerGeneratorTools, type GeneratorStatus } from "@/webmcp/generatorTool";
import type { ModelContextToolDescriptor } from "@/webmcp/modelContext";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; host: HTMLElement }[] = [];
function mount(el: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  mounted.push({ root, host });
  return host;
}
afterEach(() => {
  for (const m of mounted) { act(() => m.root.unmount()); m.host.remove(); }
  mounted = [];
  delete (document as any).modelContext;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Probe() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname}{l.search}</div>;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("normalizeProductUrl", () => {
  it("accepts http(s), upgrades http, adds a missing scheme, strips the hash", () => {
    expect(normalizeProductUrl("https://www.brooklinen.com/products/luxe-core-sheet-set")).toEqual({ ok: true, url: "https://www.brooklinen.com/products/luxe-core-sheet-set" });
    expect(normalizeProductUrl("http://www.allbirds.com/products/x?variant=1#top")).toEqual({ ok: true, url: "https://www.allbirds.com/products/x?variant=1" });
    expect(normalizeProductUrl("  www.allbirds.com/products/x ")).toEqual({ ok: true, url: "https://www.allbirds.com/products/x" });
  });
  it("rejects empty, non-http and host-less input", () => {
    expect(normalizeProductUrl("")).toMatchObject({ ok: false });
    expect(normalizeProductUrl("ftp://store.com/products/x")).toMatchObject({ ok: false });
    expect(normalizeProductUrl("javascript:alert(1)")).toMatchObject({ ok: false });
    expect(normalizeProductUrl("not a url")).toMatchObject({ ok: false });
    expect(normalizeProductUrl("localhost/products/x")).toMatchObject({ ok: false });
  });
  it("maps to /p/<host>/<path>", () => {
    expect(urlToPagePath("https://www.brooklinen.com/products/luxe-core-sheet-set")).toBe("/p/www.brooklinen.com/products/luxe-core-sheet-set");
    for (const ex of EXAMPLE_URLS) {
      const r = normalizeProductUrl(ex.url);
      expect(r.ok).toBe(true);
      expect(urlToPagePath(ex.url)).toMatch(/^\/p\/[a-z0-9.-]+\/.+$/);
    }
    expect(EXAMPLE_URLS.length).toBeGreaterThanOrEqual(4);
    expect(EXAMPLE_URLS.length).toBeLessThanOrEqual(8);
  });
});

describe("GeneratorPage", () => {
  it("renders the hero, badge, chips and tool list", () => {
    const host = mount(<MemoryRouter><GeneratorPage /><Probe /></MemoryRouter>);
    expect(host.textContent).toContain("Make any product page agent-ready.");
    expect(host.textContent).toContain("No agent connected");
    expect(host.querySelectorAll(".gen-chip").length).toBe(EXAMPLE_URLS.length);
    for (const name of TOOL_NAMES) expect(host.querySelector(".gen-tools")!.textContent).toContain(name);
    expect(host.textContent).toContain("Built by Aigency for the OpenAI WebMCP Challenge");
  });

  it("validates the URL and navigates to /p/<host>/<path>", () => {
    const host = mount(<MemoryRouter><GeneratorPage /><Probe /></MemoryRouter>);
    const input = host.querySelector<HTMLInputElement>("#gen-url")!;
    const form = input.closest("form")!;

    typeInto(input, "nope");
    act(() => form.requestSubmit());
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="loc"]')!.textContent).toBe("/");

    typeInto(input, "http://www.brooklinen.com/products/luxe-core-sheet-set");
    act(() => form.requestSubmit());
    expect(host.querySelector('[data-testid="loc"]')!.textContent).toBe("/p/www.brooklinen.com/products/luxe-core-sheet-set");
  });

  it("example chips navigate", () => {
    const host = mount(<MemoryRouter><GeneratorPage /><Probe /></MemoryRouter>);
    const chip = host.querySelector<HTMLButtonElement>(".gen-chip")!;
    act(() => chip.click());
    expect(host.querySelector('[data-testid="loc"]')!.textContent).toBe(urlToPagePath(EXAMPLE_URLS[0].url));
  });

  it("shows the site-tools badge when an agent API is present", () => {
    (document as any).modelContext = { registerTool: vi.fn(), unregisterTool: vi.fn() };
    const host = mount(<MemoryRouter><GeneratorPage /></MemoryRouter>);
    expect(host.textContent).toContain("2 site tools on this page");
  });
});

describe("make_agent_ready", () => {
  const okResult: ExtractResult = {
    ok: true,
    source: "shopify",
    warnings: [],
    fetchedMs: 12,
    cached: false,
    product: {
      id: "1", url: "https://www.brooklinen.com/products/luxe-core-sheet-set", canonicalUrl: "https://www.brooklinen.com/products/luxe-core-sheet-set", host: "www.brooklinen.com",
      brand: "Brooklinen", title: "Luxe Sateen Core Sheet Set", description: "", images: [], price: { amount: 169, currency: "USD" }, options: [],
      variants: [{ id: "v1", title: "Queen", options: {}, price: { amount: 169, currency: "USD" }, available: true }], specs: {}, availability: "in_stock",
      platform: "shopify", cart: { kind: "shopify_permalink", base: "https://www.brooklinen.com" }, extractedAt: new Date().toISOString(),
    },
  };

  function stubContext() {
    const registry = new Map<string, ModelContextToolDescriptor>();
    const ctx = {
      registerTool: vi.fn((t: ModelContextToolDescriptor) => { registry.set(t.name, t); }),
      unregisterTool: vi.fn((name: string) => { registry.delete(name); }),
    };
    (document as any).modelContext = ctx;
    return { ctx, registry };
  }

  it("registers two tools on document.modelContext and returns the page URL, then navigates after 400 ms", async () => {
    vi.useFakeTimers();
    const { ctx, registry } = stubContext();
    const fetchMock = vi.fn(async () => ({ json: async () => okResult }));
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();
    let status: GeneratorStatus | undefined;

    const cleanup = registerGeneratorTools({ navigate, onStatus: (s) => { status = s; } });
    expect(ctx.registerTool).toHaveBeenCalledTimes(2);
    expect(status).toEqual({ api: "document.modelContext", tools: 2 });
    const tool = registry.get("make_agent_ready")!;
    expect(tool.inputSchema).toMatchObject({ required: ["url"] });
    expect(registry.get("list_examples")!.annotations?.readOnlyHint).toBe(true);

    const res = await tool.execute({ url: "http://www.brooklinen.com/products/luxe-core-sheet-set" });
    expect(fetchMock).toHaveBeenCalledWith(`/api/extract?url=${encodeURIComponent("https://www.brooklinen.com/products/luxe-core-sheet-set")}`);
    expect(res).toEqual({
      ok: true,
      page_url: `${location.origin}/p/www.brooklinen.com/products/luxe-core-sheet-set`,
      title: "Luxe Sateen Core Sheet Set",
      source: "shopify",
      tools: [...TOOL_NAMES],
      note: "Open page_url to use the tools; they are registered on that page only.",
    });
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(399);
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(navigate).toHaveBeenCalledWith("/p/www.brooklinen.com/products/luxe-core-sheet-set");

    const examples = (await registry.get("list_examples")!.execute({})) as { examples: { url: string; page_url: string }[] };
    expect(examples.examples.length).toBe(EXAMPLE_URLS.length);
    expect(examples.examples[0].page_url).toBe(location.origin + urlToPagePath(EXAMPLE_URLS[0].url));

    cleanup();
    expect(ctx.unregisterTool).toHaveBeenCalledWith("make_agent_ready");
    expect(ctx.unregisterTool).toHaveBeenCalledWith("list_examples");
  });

  it("returns structured errors for invalid URLs and failed extraction, and does not navigate", async () => {
    vi.useFakeTimers();
    const { registry } = stubContext();
    const failed: ExtractResult = { ok: false, code: "no_product", error: "No product data on the page." };
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => failed })));
    const navigate = vi.fn();
    const cleanup = registerGeneratorTools({ navigate });
    const tool = registry.get("make_agent_ready")!;

    expect(await tool.execute({ url: "not a url" })).toMatchObject({ ok: false, code: "invalid_url" });
    expect(await tool.execute({})).toMatchObject({ ok: false, code: "invalid_url" });
    expect(await tool.execute({ url: "https://example.com/x" })).toEqual({ ok: false, code: "no_product", error: "No product data on the page." });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    expect(await tool.execute({ url: "https://example.com/x" })).toEqual({ ok: false, code: "fetch_failed", error: "boom" });

    vi.advanceTimersByTime(1000);
    expect(navigate).not.toHaveBeenCalled();
    cleanup();
  });

  it("is a no-op without an agent API", () => {
    let status: GeneratorStatus | undefined;
    const cleanup = registerGeneratorTools({ onStatus: (s) => { status = s; } });
    expect(status).toEqual({ api: "none", tools: 0 });
    expect(() => cleanup()).not.toThrow();
  });
});
