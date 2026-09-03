// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { ExtractResult, Product } from "@shared/types";
import { ComparePage } from "@/pages/Compare";

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
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

function product(host: string, title: string, specs: Record<string, string>, extra: Partial<Product> = {}): Product {
  const url = `https://${host}/products/${title.toLowerCase().replace(/\s+/g, "-")}`;
  return {
    id: title, url, canonicalUrl: url, host, brand: host.split(".")[1], title, description: "", images: [`https://${host}/img.jpg`],
    price: { amount: 100, currency: "USD" }, options: [{ name: "Size", values: ["S", "M"] }],
    variants: [{ id: "v", title: "S", options: { Size: "S" }, price: { amount: 100, currency: "USD" }, available: true }],
    specs, availability: "in_stock", platform: "shopify", cart: { kind: "shopify_permalink", base: `https://${host}` }, extractedAt: new Date().toISOString(), ...extra,
  };
}

describe("ComparePage", () => {
  it("asks for two URLs when params are missing", () => {
    const host = mount(<MemoryRouter initialEntries={["/compare?a=https://x.com/p"]}><ComparePage /></MemoryRouter>);
    expect(host.textContent).toContain("Two product URLs are needed");
  });

  it("fetches both in parallel and renders side by side with the union of spec keys", async () => {
    const a = "https://www.brooklinen.com/products/luxe-core-sheet-set";
    const b = "https://www.allbirds.com/products/womens-dasher-nz-blizzard-deep-navy";
    const results: Record<string, ExtractResult> = {
      [a]: { ok: true, source: "shopify", warnings: [], fetchedMs: 1, cached: false, product: product("www.brooklinen.com", "Luxe Sateen", { Material: "Sateen" }, { compareAtPrice: { amount: 200, currency: "USD" } }) },
      [b]: { ok: true, source: "jsonld", warnings: [], fetchedMs: 1, cached: false, product: product("www.allbirds.com", "Dasher NZ", { Weight: "300 g" }, { availability: "unknown" }) },
    };
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost").searchParams.get("url")!;
      return { json: async () => results[url] };
    });
    vi.stubGlobal("fetch", fetchMock);

    const host = mount(<MemoryRouter initialEntries={[`/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`]}><ComparePage /></MemoryRouter>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Loading…");
    await settle();

    const text = host.textContent!;
    expect(text).toContain("Luxe Sateen");
    expect(text).toContain("Dasher NZ");
    expect(text).toContain("Material");
    expect(text).toContain("Weight");
    expect(text).toContain("shopify");
    expect(text).toContain("jsonld");
    expect(text).toContain("Unknown — no live inventory signal");
    expect(text).toContain("$200.00");
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>("a")).filter((l) => l.textContent === "Open agent-ready page");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/p/www.brooklinen.com/products/luxe-core-sheet-set", "/p/www.allbirds.com/products/womens-dasher-nz-blizzard-deep-navy"]);
    expect(host.querySelectorAll("img.cmp-img").length).toBe(2);
  });

  it("shows an error for the side that failed and still renders the other", async () => {
    const a = "https://www.brooklinen.com/products/luxe-core-sheet-set";
    const b = "https://blocked.example/products/x";
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost").searchParams.get("url")!;
      const r: ExtractResult = url === a
        ? { ok: true, source: "shopify", warnings: [], fetchedMs: 1, cached: false, product: product("www.brooklinen.com", "Luxe Sateen", {}) }
        : { ok: false, code: "blocked_by_site", error: "The site refused the fetch (403)." };
      return { json: async () => r };
    });
    vi.stubGlobal("fetch", fetchMock);
    const host = mount(<MemoryRouter initialEntries={[`/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`]}><ComparePage /></MemoryRouter>);
    await settle();
    expect(host.textContent).toContain("Luxe Sateen");
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("blocked_by_site: The site refused the fetch (403).");
  });
});
