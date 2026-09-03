// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { DEFAULT_POLICY, type ExtractResult } from "@shared/types";
import { useStore } from "@/state/store";
import { MOCK_PRODUCT } from "@/lib/mock";
import { ProductPage } from "@/pages/Product";
import { resetRateLimit } from "@/webmcp/gate";

vi.hoisted(() => {
  const g = globalThis as any;
  if (!g.localStorage) {
    const mem = new Map<string, string>();
    Object.defineProperty(g, "localStorage", {
      configurable: true, writable: true,
      value: { get length() { return mem.size; }, clear: () => mem.clear(), getItem: (k: string) => mem.get(k) ?? null, key: (i: number) => [...mem.keys()][i] ?? null, removeItem: (k: string) => { mem.delete(k); }, setItem: (k: string, v: string) => { mem.set(k, String(v)); } },
    });
  }
  (g as any).IS_REACT_ACT_ENVIRONMENT = true;
});

const PATH = "/p/example-store.test/products/meridian-linen-duvet-cover";
const okResult: ExtractResult = { ok: true, source: "shopify", product: MOCK_PRODUCT, warnings: [], fetchedMs: 12, cached: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let root: Root | null = null;
let host: HTMLDivElement;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (el: Element | null) => act(() => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });

async function render(path = PATH) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<div data-testid="home">home</div>} />
          <Route path="/p/*" element={<ProductPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await flush();
}

describe("ProductPage", () => {
  beforeEach(() => {
    useStore.setState({ product: null, source: null, warnings: [], loading: false, error: null, session: { pinned: [], cart: [], humanActions: 0 }, policy: DEFAULT_POLICY, ledger: [], pendingConfirm: null, agentApi: "none", registeredTools: [], agentTrace: null, compare: null });
    resetRateLimit();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/extract")) return json(okResult);
      if (url.startsWith("/api/ask")) return new Response(null, { status: 501 });
      return json({ ok: false }, 404);
    });
  });
  afterEach(async () => {
    if (root) { await act(async () => { root!.unmount(); }); root = null; }
    host?.remove();
    vi.restoreAllMocks();
  });

  it("renders the extracted product with the stable test ids", async () => {
    await render();
    expect((fetch as any).mock.calls[0][0]).toBe(`/api/extract?url=${encodeURIComponent("https://example-store.test/products/meridian-linen-duvet-cover")}`);
    expect(q("product-title")?.textContent).toBe("Linen Duvet Cover");
    expect(document.title).toBe("Linen Duvet Cover · agent-ready");
    expect(q("price")?.textContent).toContain("$119.00"); // first available variant: Twin / White
    for (const id of ["variant-option-Size-Queen", "variant-option-Color-Sand", "add-to-cart", "pin-variant", "site-tools-badge", "source-note", "agent-notice"]) {
      expect(q(id), id).not.toBeNull();
    }
    expect(q("variant-option-Size-Twin")?.className).toContain("selected");
    expect(q("source-note")?.textContent).toContain("Shopify");
    expect(typeof window.__agentpdp?.call).toBe("function");
  });

  it("human variant clicks select through the store and mark out-of-stock combinations", async () => {
    await render();
    click(q("variant-option-Size-King"));
    expect(useStore.getState().session.selectedVariantId).toBe("41000000005");
    expect(useStore.getState().session.humanActions).toBe(1);
    expect(q("variant-option-Color-Sand")?.className).toContain("unavailable"); // King / Sand is out of stock
    click(q("variant-option-Color-Sand"));
    expect(q("availability")?.textContent).toBe("Out of stock");
    expect((q("add-to-cart") as HTMLButtonElement).disabled).toBe(true);
    click(q("variant-option-Color-White"));
    click(q("pin-variant"));
    expect(useStore.getState().session.pinned).toEqual(["41000000005"]);
    expect(q("pin-variant")?.textContent).toBe("Unpin");
  });

  it("human add to cart uses the store and opens the permalink", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await render();
    click(q("add-to-cart"));
    expect(useStore.getState().session.cart).toEqual([{ variantId: "41000000001", qty: 1, title: "Twin / White", price: { amount: 119, currency: "USD" } }]);
    expect(open).toHaveBeenCalledWith("https://example-store.test/cart/41000000001:1", "_blank", "noopener");
    expect(q("cart-badge")?.textContent).toBe("Cart · 1");
    expect(useStore.getState().session.humanActions).toBe(1);
  });

  it("an agent selection flashes and toasts; the human counter stays put", async () => {
    await render();
    let res: any;
    await act(async () => { res = await window.__agentpdp!.call("select_variant", { options: { Size: "Queen", Color: "Sand" } }); });
    expect(res.ok).toBe(true);
    expect(res.variant.variant_id).toBe("41000000004");
    expect(q("agent-toast")?.textContent).toContain("Agent selected Queen / Sand");
    expect(q("variant-option-Size-Queen")?.className).toContain("selected");
    expect(q("variant-option-Size-Queen")?.className).toContain("agent-flash");
    expect(useStore.getState().session.humanActions).toBe(0);
  });

  it("add_to_cart under the confirm policy shows the dialog; approve completes the call", async () => {
    await render();
    const pending = window.__agentpdp!.call("add_to_cart", { variant_id: "41000000003", quantity: 2 });
    await flush();
    expect(q("confirm-dialog")?.textContent).toContain("Add Queen / White ×2 ($139.00) to cart");
    click(q("confirm-approve"));
    const res: any = await pending;
    expect(res.ok).toBe(true);
    expect(res.checkout_url).toBe("https://example-store.test/cart/41000000003:2");
    await flush();
    expect(q("confirm-dialog")).toBeNull();
    expect(useStore.getState().ledger[0].outcome).toBe("confirmed");

    const declined = window.__agentpdp!.call("add_to_cart", { variant_id: "41000000001" });
    await flush();
    click(q("confirm-decline"));
    expect(((await declined) as any).code).toBe("denied");
  });

  it("shows a plain-English error with retry when extraction fails", async () => {
    (fetch as any).mockImplementation(async () => json({ ok: false, code: "no_product", error: "no Product schema" }, 422));
    await render();
    expect(q("product-error")?.textContent).toContain("No product data was found on that page");
    expect(q("product-error")?.textContent).toContain("Retry");
    expect(q("product-error")?.querySelector('a[href="/"]')).not.toBeNull();
    expect(q("product-title")).toBeNull();
  });

  it("/p?url= redirects to the canonical /p/<host>/<path>", async () => {
    await render("/p?url=https%3A%2F%2Fexample-store.test%2Fproducts%2Fmeridian-linen-duvet-cover");
    await flush();
    expect((fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes(encodeURIComponent("https://example-store.test/products/meridian-linen-duvet-cover")))).toBe(true);
    expect(q("product-title")?.textContent).toBe("Linen Duvet Cover");
  });
});
