// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TOOL_NAMES, DEFAULT_POLICY, type Product } from "@shared/types";
import { useStore } from "@/state/store";
import { MOCK_PRODUCT } from "@/lib/mock";
import { registerPageTools, guardedHandler } from "@/webmcp/register";
import { resetRateLimit, stripCompareAt, confirmSummary } from "@/webmcp/gate";
import { checkoutUrl, resolveVariant } from "@/webmcp/handlers";
import { deterministicAnswer, NO_ANSWER } from "@/webmcp/deterministic";
import type { ModelContextToolDescriptor } from "@/webmcp/modelContext";

// vitest's jsdom exposes `localStorage` as undefined; the store's persist middleware needs a Storage. Polyfill before the store module loads.
vi.hoisted(() => {
  const g = globalThis as any;
  if (!g.localStorage) {
    const mem = new Map<string, string>();
    const storage: Storage = {
      get length() { return mem.size; },
      clear: () => mem.clear(),
      getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
      key: (i) => [...mem.keys()][i] ?? null,
      removeItem: (k) => { mem.delete(k); },
      setItem: (k, v) => { mem.set(k, String(v)); },
    };
    Object.defineProperty(g, "localStorage", { value: storage, configurable: true, writable: true });
  }
});

/** In-memory stand-in for document.modelContext: registerTool(tool, { signal }) and unregister on abort. */
class FakeModelContext extends EventTarget {
  tools = new Map<string, ModelContextToolDescriptor>();
  registerCalls = 0;
  toolchanges = 0;
  constructor() { super(); this.addEventListener("toolchange", () => { this.toolchanges++; }); }
  registerTool(tool: ModelContextToolDescriptor, opts?: { signal?: AbortSignal }) {
    this.registerCalls++;
    if (this.tools.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`);
    this.tools.set(tool.name, tool);
    opts?.signal?.addEventListener("abort", () => {
      if (this.tools.get(tool.name) === tool) { this.tools.delete(tool.name); this.dispatchEvent(new Event("toolchange")); }
    });
    this.dispatchEvent(new Event("toolchange"));
  }
  unregisterTool(name: string) { this.tools.delete(name); }
}

function installCtx(): FakeModelContext {
  const ctx = new FakeModelContext();
  Object.defineProperty(document, "modelContext", { value: ctx, configurable: true, writable: true });
  return ctx;
}
function removeCtx() { delete (document as any).modelContext; }

function resetStore(product: Product | null = MOCK_PRODUCT) {
  useStore.setState({
    product: null, source: null, warnings: [], loading: false, error: null,
    session: { pinned: [], cart: [], humanActions: 0 },
    policy: DEFAULT_POLICY, ledger: [], pendingConfirm: null, agentApi: "none", registeredTools: [], agentTrace: null, compare: null,
  });
  if (product) useStore.getState().setProduct(product, "shopify", []);
  resetRateLimit();
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe("registerPageTools", () => {
  let ctx: FakeModelContext;
  let cleanup: () => void = () => {};
  beforeEach(() => { ctx = installCtx(); resetStore(); });
  afterEach(() => { cleanup(); removeCtx(); });

  it("registers the 8 tools in TOOL_NAMES order and reports the api", () => {
    cleanup = registerPageTools();
    expect([...ctx.tools.keys()]).toEqual([...TOOL_NAMES]);
    expect(useStore.getState().registeredTools).toEqual([...TOOL_NAMES]);
    expect(useStore.getState().agentApi).toBe("document.modelContext");
    const add = ctx.tools.get("add_to_cart")!;
    expect(add.annotations?.consequentialHint).toBe(true);
    expect(ctx.tools.get("get_product")!.annotations?.readOnlyHint).toBe(true);
    expect(add.description).toContain("Meridian Linen Duvet Cover");
  });

  it("policy off unregisters exactly that tool via abort; on restores it", () => {
    cleanup = registerPageTools();
    const before = ctx.toolchanges;
    useStore.getState().setToolPolicy("add_to_cart", "off");
    expect(ctx.tools.has("add_to_cart")).toBe(false);
    expect(ctx.tools.size).toBe(7);
    expect(ctx.toolchanges).toBe(before + 1);
    expect(useStore.getState().registeredTools).toEqual(TOOL_NAMES.filter(n => n !== "add_to_cart"));

    useStore.getState().setToolPolicy("add_to_cart", "on");
    expect(ctx.tools.has("add_to_cart")).toBe(true);
    expect(ctx.tools.size).toBe(8);
    expect(useStore.getState().registeredTools).toEqual([...TOOL_NAMES]);

    // confirm keeps the tool registered (the gate lives inside execute)
    useStore.getState().setToolPolicy("add_to_cart", "confirm");
    expect(ctx.tools.has("add_to_cart")).toBe(true);
  });

  it("registers nothing without a product, then everything once one lands; re-registers on product change", () => {
    resetStore(null);
    cleanup = registerPageTools();
    expect(ctx.tools.size).toBe(0);
    useStore.getState().setProduct(MOCK_PRODUCT, "shopify", []);
    expect(ctx.tools.size).toBe(8);
    const calls = ctx.registerCalls;
    useStore.getState().setProduct({ ...MOCK_PRODUCT, id: "other", title: "Other Thing" }, "jsonld", []);
    expect(ctx.tools.size).toBe(8);
    expect(ctx.registerCalls).toBe(calls + 8);
    expect(ctx.tools.get("get_product")!.description).toContain("Other Thing");
  });

  it("cleanup aborts every registration", () => {
    cleanup = registerPageTools();
    cleanup();
    cleanup = () => {};
    expect(ctx.tools.size).toBe(0);
    expect(useStore.getState().registeredTools).toEqual([]);
  });

  it("reports api none when no modelContext exists", () => {
    removeCtx();
    cleanup = registerPageTools();
    expect(useStore.getState().agentApi).toBe("none");
    expect(useStore.getState().registeredTools).toEqual([]);
  });

  it("execute on a registered tool goes through the gate and logs", async () => {
    cleanup = registerPageTools();
    const res = (await ctx.tools.get("list_variants")!.execute({ available_only: true })) as any;
    expect(res.ok).toBe(true);
    expect(res.count).toBe(5);
    expect(useStore.getState().ledger[0]).toMatchObject({ tool: "list_variants", outcome: "ok", agent: "webmcp-agent" });
    expect(typeof useStore.getState().ledger[0].ms).toBe("number");
  });
});

describe("gate", () => {
  beforeEach(() => { removeCtx(); resetStore(); });

  it("confirm flow: approve gives ok + ledger confirmed", async () => {
    expect(useStore.getState().policy.tools.add_to_cart).toBe("confirm");
    const pending = guardedHandler("add_to_cart")({ variant_id: "41000000003" });
    await tick();
    const pc = useStore.getState().pendingConfirm;
    expect(pc).not.toBeNull();
    expect(pc!.tool).toBe("add_to_cart");
    expect(pc!.summary).toBe("Add Queen / White ×1 ($139.00) to cart");
    useStore.getState().resolveConfirm(true);
    const res = (await pending) as any;
    expect(res.ok).toBe(true);
    expect(res.checkout_url).toBe("https://example-store.test/cart/41000000003:1");
    expect(useStore.getState().ledger[0].outcome).toBe("confirmed");
    expect(useStore.getState().pendingConfirm).toBeNull();
    expect(useStore.getState().session.humanActions).toBe(0);
  });

  it("confirm flow: decline gives denied and leaves the cart alone", async () => {
    const pending = guardedHandler("add_to_cart")({ variant_id: "41000000003", quantity: 2 });
    await tick();
    expect(useStore.getState().pendingConfirm!.summary).toBe("Add Queen / White ×2 ($139.00) to cart");
    useStore.getState().resolveConfirm(false);
    const res = (await pending) as any;
    expect(res).toEqual({ ok: false, code: "denied", error: "The shopper declined this action." });
    expect(useStore.getState().ledger[0].outcome).toBe("denied");
    expect(useStore.getState().session.cart).toEqual([]);
  });

  it("rate limit: the call past the window limit is rate_limited", async () => {
    useStore.getState().setRateLimit(2);
    const a = (await guardedHandler("get_product")({})) as any;
    const b = (await guardedHandler("get_product")({})) as any;
    const c = (await guardedHandler("get_product")({})) as any;
    expect(a.ok && b.ok).toBe(true);
    expect(c.ok).toBe(false);
    expect(c.code).toBe("rate_limited");
    expect(useStore.getState().ledger[0].outcome).toBe("rate_limited");
    useStore.getState().setRateLimit(0);
    expect(((await guardedHandler("get_product")({})) as any).ok).toBe(true);
  });

  it("off policy is a defensive block even if a stale handle is called", async () => {
    useStore.getState().setToolPolicy("get_product", "off");
    const r = (await guardedHandler("get_product")({})) as any;
    expect(r).toMatchObject({ ok: false, code: "blocked" });
    expect(useStore.getState().ledger[0].outcome).toBe("blocked");
  });

  it("hideCompareAtPrice strips compare-at fields from outputs", async () => {
    const withIt = (await guardedHandler("list_variants")({})) as any;
    expect(withIt.variants.some((v: any) => v.compareAtPrice)).toBe(true);
    useStore.getState().setHideCompareAtPrice(true);
    const without = (await guardedHandler("list_variants")({})) as any;
    expect(without.variants.some((v: any) => "compareAtPrice" in v)).toBe(false);
    const prod = (await guardedHandler("get_product")({})) as any;
    expect("compareAtPrice" in prod).toBe(false);
    expect(stripCompareAt({ a: [{ compareAtPrice: 1, price: 2 }], compare_at_price: 3 })).toEqual({ a: [{ price: 2 }] });
  });

  it("never throws: a handler exception becomes an error result", async () => {
    // compare_with with a non-https URL fails cleanly; an unexpected throw is also caught
    const r = (await guardedHandler("compare_with")({ url: "http://example.com/x" })) as any;
    expect(r.ok).toBe(false);
    expect(r.code).toBe("invalid_args");
    const r2 = (await guardedHandler("select_variant")("not json")) as any;
    expect(r2.ok).toBe(false);
  });

  it("ledger resultSummary is at most 140 chars", async () => {
    await guardedHandler("get_product")({});
    expect(useStore.getState().ledger[0].resultSummary.length).toBeLessThanOrEqual(140);
  });

  it("confirmSummary names the variant", () => {
    expect(confirmSummary("add_to_cart", { variant_id: "41000000001", quantity: 3 })).toBe("Add Twin / White ×3 ($119.00) to cart");
    expect(confirmSummary("select_variant", { options: { Size: "King" } })).toBe("Select King");
  });
});

describe("handlers", () => {
  beforeEach(() => { removeCtx(); resetStore(); useStore.getState().setToolPolicy("add_to_cart", "on"); });

  it("add_to_cart builds a permalink with every cart line", async () => {
    const first = (await guardedHandler("add_to_cart")({ variant_id: "41000000003", quantity: 2 })) as any;
    expect(first.ok).toBe(true);
    const second = (await guardedHandler("add_to_cart")({ variant_id: "41000000001" })) as any;
    expect(second.ok).toBe(true);
    expect(second.checkout_url).toBe("https://example-store.test/cart/41000000003:2,41000000001:1");
    expect(second.cart.count).toBe(3);
    expect(second.cart.subtotal).toEqual({ amount: 397, currency: "USD" });
    expect(useStore.getState().agentTrace?.message).toBe("Agent added Twin / White ×1 to cart");
    expect(useStore.getState().session.humanActions).toBe(0);
  });

  it("add_to_cart refuses an out-of-stock variant and bad quantities", async () => {
    const r = (await guardedHandler("add_to_cart")({ variant_id: "41000000006" })) as any;
    expect(r).toMatchObject({ ok: false, code: "unavailable" });
    const q = (await guardedHandler("add_to_cart")({ variant_id: "41000000001", quantity: 11 })) as any;
    expect(q.code).toBe("invalid_args");
    const nf = (await guardedHandler("add_to_cart")({ variant_id: "nope" })) as any;
    expect(nf.code).toBe("not_found");
  });

  it("pdp_link stores get the product URL and a note", () => {
    const p: Product = { ...MOCK_PRODUCT, cart: { kind: "pdp_link" } };
    const r = checkoutUrl(p, [{ variantId: "41000000003", qty: 1, title: "Queen / White", price: p.price }], p.variants[2]);
    expect(r.url).toBe(p.variants[2].url);
    expect(r.note).toMatch(/no programmatic cart/);
  });

  it("select_variant resolves by options, case-insensitively, and leaves a trace", async () => {
    const r = (await guardedHandler("select_variant")({ options: { size: "king", COLOR: "white" } })) as any;
    expect(r.ok).toBe(true);
    expect(r.variant.variant_id).toBe("41000000005");
    expect(useStore.getState().session.selectedVariantId).toBe("41000000005");
    expect(useStore.getState().agentTrace).toMatchObject({ kind: "select", variantId: "41000000005", message: "Agent selected King / White" });
    expect(useStore.getState().session.humanActions).toBe(0);
    const partial = (await guardedHandler("select_variant")({ options: { Size: "Queen" } })) as any;
    expect(partial.matched_count).toBe(2);
    expect(partial.variant.options.Size).toBe("Queen");
    const miss = (await guardedHandler("select_variant")({ options: { Size: "Cot" } })) as any;
    expect(miss).toMatchObject({ ok: false, code: "not_found" });
    expect(resolveVariant(MOCK_PRODUCT, {})).toMatchObject({ ok: false, code: "invalid_args" });
  });

  it("list_variants filters by availability and price", async () => {
    const r = (await guardedHandler("list_variants")({ available_only: true, max_price: 120 })) as any;
    expect(r.variants.map((v: any) => v.variant_id)).toEqual(["41000000001", "41000000002"]);
    expect(r.total_variants).toBe(6);
  });

  it("get_product is trimmed and carries page context", async () => {
    const long = { ...MOCK_PRODUCT, description: "x".repeat(3000), images: Array.from({ length: 9 }, (_, i) => `https://example-store.test/${i}.jpg`) };
    useStore.getState().setProduct(long, "shopify", []);
    useStore.getState().setRegisteredTools([...TOOL_NAMES]);
    const r = (await guardedHandler("get_product")({})) as any;
    expect(r.description.length).toBeLessThanOrEqual(1500);
    expect(r.images).toHaveLength(6);
    expect(r.cart_mode).toBe("shopify_permalink");
    expect(r.tools_available).toEqual([...TOOL_NAMES]);
    expect(typeof r.page_url).toBe("string");
  });

  it("check_availability is honest when there is no live feed", async () => {
    useStore.getState().setProduct({ ...MOCK_PRODUCT, platform: "unknown", cart: { kind: "pdp_link" } }, "jsonld", []);
    const r = (await guardedHandler("check_availability")({ variant_id: "41000000003" })) as any;
    expect(r.ok).toBe(true);
    expect(r.available).toBe("unknown");
    expect(r.reason).toBe("no live inventory feed on this page; schema.org availability at extract time was in_stock");
  });

  it("check_availability refetches the Shopify feed fresh", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(String(input)).toContain("fresh=1");
      const live = { ...MOCK_PRODUCT, variants: MOCK_PRODUCT.variants.map(v => v.id === "41000000003" ? { ...v, available: false } : v) };
      return new Response(JSON.stringify({ ok: true, source: "shopify", product: live, warnings: [], fetchedMs: 5, cached: false }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const r = (await guardedHandler("check_availability")({ variant_id: "41000000003" })) as any;
    expect(r.available).toBe(false);
    expect(r.source).toBe("shopify live product feed");
    fetchSpy.mockRestore();
  });

  it("ask_about_product falls back to deterministic answers when the server answers 501", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 501 }));
    const known = (await guardedHandler("ask_about_product")({ question: "What material is it made of?" })) as any;
    expect(known.mode).toBe("deterministic");
    expect(known.grounded).toBe(true);
    expect(known.answer).toContain("European flax linen");
    expect(known.sources).toContain("specs.Material");
    const unknown = (await guardedHandler("ask_about_product")({ question: "What is the warranty period?" })) as any;
    expect(unknown.answer).toBe(NO_ANSWER);
    expect(unknown.sources).toEqual([]);
    fetchSpy.mockRestore();
  });

  it("deterministic ask says the page doesn't say when nothing overlaps", () => {
    expect(deterministicAnswer(MOCK_PRODUCT, "Is there a firmware update?").answer).toBe(NO_ANSWER);
    expect(deterministicAnswer(MOCK_PRODUCT, "duvet cover").answer).toBe(NO_ANSWER);
    const care = deterministicAnswer(MOCK_PRODUCT, "Can I machine wash it?");
    expect(care.answer).toMatch(/wash/i);
    const price = deterministicAnswer(MOCK_PRODUCT, "How much does it cost?");
    expect(price.answer).toContain("$139.00");
    expect(price.sources).toContain("price");
  });

  it("get_session_state exposes policies, tools and the cart", async () => {
    useStore.getState().setRegisteredTools([...TOOL_NAMES]);
    useStore.getState().togglePin("41000000003");
    const r = (await guardedHandler("get_session_state")({})) as any;
    expect(r.policies).toEqual(useStore.getState().policy.tools);
    expect(useStore.getState().session).toMatchObject(r.session); // the ledger stamps lastToolCall after the handler ran
    expect(r.session.pinned).toEqual(["41000000003"]);
    expect(r.registered_tools).toEqual([...TOOL_NAMES]);
    expect(r.pinned).toEqual([{ variant_id: "41000000003", title: "Queen / White" }]);
    expect(r.human_actions).toBe(1);
    expect(r.selected_variant.variant_id).toBe("41000000001");
  });

  it("compare_with fetches the other page, diffs, and opens the drawer", async () => {
    const other: Product = { ...MOCK_PRODUCT, id: "b1", title: "Percale Duvet Cover", host: "www.other.test", url: "https://www.other.test/products/percale", canonicalUrl: "https://www.other.test/products/percale", price: { amount: 159, currency: "USD" }, specs: { Material: "100% long-staple cotton percale", Weave: "Percale" }, options: [{ name: "Size", values: ["Queen", "King", "Cal King"] }] };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, source: "shopify", product: other, warnings: [], fetchedMs: 1, cached: false }), { status: 200 }));
    const r = (await guardedHandler("compare_with")({ url: "https://www.other.test/products/percale" })) as any;
    expect(r.ok).toBe(true);
    expect(r.differences.price).toEqual({ a: { amount: 139, currency: "USD" }, b: { amount: 159, currency: "USD" }, delta: 20, cheaper: "a" });
    expect(r.differences.options.only_a).toEqual(["Color"]);
    expect(r.differences.options.shared[0]).toMatchObject({ name: "Size", only_a: ["Twin"], only_b: ["Cal King"] });
    expect(r.differences.specs.shared[0]).toMatchObject({ key: "Material", same: false });
    expect(r.differences.specs.only_b).toEqual({ Weave: "Percale" });
    expect(useStore.getState().compare?.b.id).toBe("b1");
    expect(r.compare_url).toContain("/compare?a=");
    fetchSpy.mockRestore();
  });
});
