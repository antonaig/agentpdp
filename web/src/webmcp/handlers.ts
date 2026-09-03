import type { Product, Variant, ToolName, CartLine, ExtractResult } from "@shared/types";
import { useStore } from "@/state/store";
import { fetchExtract, askServer } from "@/lib/api";
import { formatMoney, variantLabel } from "@/lib/format";
import { deterministicAnswer } from "./deterministic";
import { diffProducts } from "./compare";

/**
 * The 8 tool handlers. Pure functions over the store + the API client; no React, no DOM beyond `location`.
 * Every handler returns a JSON-serializable object. Failures are `{ ok:false, code, error }` — never thrown.
 * The gate (gate.ts) adds rate limiting, policy, confirm, ledger and the compare-at-price filter around these.
 */
export type ToolArgs = Record<string, unknown>;
export type ToolResult = Record<string, unknown>;
export type ToolHandler = (args: ToolArgs) => Promise<ToolResult>;

export interface ToolFailure extends ToolResult { ok: false; code: string; error: string }
export const fail = (code: string, error: string, extra: ToolResult = {}): ToolFailure => ({ ok: false, code, error, ...extra });

const pageUrl = () => (globalThis as any).location?.href ?? "";
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

function product(): Product | null { return useStore.getState().product; }

export function slimVariant(v: Variant) {
  return {
    variant_id: v.id,
    title: variantLabel(v),
    options: v.options,
    price: v.price,
    ...(v.compareAtPrice ? { compareAtPrice: v.compareAtPrice } : {}),
    available: v.available,
    ...(v.sku ? { sku: v.sku } : {}),
    ...(v.url ? { url: v.url } : {}),
  };
}

export function slimProduct(p: Product) {
  return {
    id: p.id,
    title: p.title,
    brand: p.brand ?? null,
    url: p.canonicalUrl || p.url,
    host: p.host,
    price: p.price,
    ...(p.compareAtPrice ? { compareAtPrice: p.compareAtPrice } : {}),
    ...(p.priceRange ? { priceRange: p.priceRange } : {}),
    currency: p.price.currency,
    description: p.description.length > 1500 ? `${p.description.slice(0, 1499).trimEnd()}…` : p.description,
    images: p.images.slice(0, 6),
    options: p.options,
    specs: p.specs,
    ...(p.rating ? { rating: p.rating } : {}),
    availability: p.availability,
    platform: p.platform,
    variant_count: p.variants.length,
    variants: p.variants.map(v => ({ variant_id: v.id, title: variantLabel(v), options: v.options, price: v.price, available: v.available })),
    extractedAt: p.extractedAt,
  };
}

/** Resolve a variant from `variant_id` or an `options` map (case-insensitive on names and values). */
export function resolveVariant(p: Product, args: ToolArgs): { variant: Variant; matched: number } | ToolFailure {
  const id = str(args.variant_id);
  if (id) {
    const v = p.variants.find(x => String(x.id) === id);
    if (!v) return fail("not_found", `No variant with id "${id}". Call list_variants for valid ids.`, { known_ids: p.variants.slice(0, 20).map(x => x.id) });
    return { variant: v, matched: 1 };
  }
  const opts = args.options;
  if (opts && typeof opts === "object" && !Array.isArray(opts) && Object.keys(opts).length > 0) {
    const wanted = Object.entries(opts as Record<string, unknown>).map(([k, v]) => [k.trim().toLowerCase(), String(v).trim().toLowerCase()] as const);
    const matches = p.variants.filter(v => {
      const have = Object.entries(v.options).map(([k, val]) => [k.trim().toLowerCase(), String(val).trim().toLowerCase()] as const);
      return wanted.every(([wk, wv]) => have.some(([hk, hv]) => hk === wk && hv === wv));
    });
    if (matches.length === 0) {
      return fail("not_found", `No variant matches ${JSON.stringify(opts)}.`, { options: p.options });
    }
    const pick = matches.find(v => v.available !== false) ?? matches[0];
    return { variant: pick, matched: matches.length };
  }
  return fail("invalid_args", "Pass variant_id (from list_variants) or options, e.g. {\"Size\":\"Queen\"}.", { options: p.options });
}

const isFailure = (x: unknown): x is ToolFailure => !!x && typeof x === "object" && (x as any).ok === false;

/** Shopify cart permalink for every line in the cart; otherwise the variant/product URL. */
export function checkoutUrl(p: Product, cart: CartLine[], variant?: Variant): { url: string; note?: string } {
  if (p.cart.kind === "shopify_permalink") {
    const base = p.cart.base.replace(/\/+$/, "");
    const lines = cart.length ? cart : variant ? [{ variantId: variant.id, qty: 1 }] : [];
    return { url: `${base}/cart/${lines.map(l => `${l.variantId}:${l.qty}`).join(",")}` };
  }
  return {
    url: variant?.url || p.canonicalUrl || p.url,
    note: "This store exposes no programmatic cart. The link opens the product page, where the human can add it to the cart.",
  };
}

async function fetchExtractFresh(url: string): Promise<ExtractResult> {
  const res = await fetch(`/api/extract?url=${encodeURIComponent(url)}&fresh=1`);
  return (await res.json()) as ExtractResult;
}

export const handlers: Record<ToolName, ToolHandler> = {
  async get_product() {
    const p = product();
    if (!p) return fail("no_product", "This page has no product loaded yet.");
    const s = useStore.getState();
    return {
      ok: true,
      ...slimProduct(p),
      page_url: pageUrl(),
      cart_mode: p.cart.kind,
      tools_available: s.registeredTools,
    };
  },

  async list_variants(args) {
    const p = product();
    if (!p) return fail("no_product", "This page has no product loaded yet.");
    const availableOnly = args.available_only === true || args.available_only === "true";
    const maxPrice = typeof args.max_price === "number" ? args.max_price : typeof args.max_price === "string" && args.max_price.trim() !== "" ? Number(args.max_price) : undefined;
    if (maxPrice !== undefined && Number.isNaN(maxPrice)) return fail("invalid_args", "max_price must be a number.");
    let list = p.variants;
    if (availableOnly) list = list.filter(v => v.available === true);
    if (maxPrice !== undefined) list = list.filter(v => v.price.amount <= maxPrice);
    const s = useStore.getState().session;
    return {
      ok: true,
      currency: p.price.currency,
      count: list.length,
      total_variants: p.variants.length,
      filters: { available_only: availableOnly, ...(maxPrice !== undefined ? { max_price: maxPrice } : {}) },
      selected_variant_id: s.selectedVariantId ?? null,
      availability_note: p.platform === "shopify" ? "available reflects the store feed at extract time; call check_availability for a live read." : "available is null when the page has no inventory signal.",
      variants: list.map(slimVariant),
    };
  },

  async select_variant(args) {
    const p = product();
    if (!p) return fail("no_product", "This page has no product loaded yet.");
    const r = resolveVariant(p, args);
    if (isFailure(r)) return r;
    const store = useStore.getState();
    store.selectVariant(r.variant.id, "agent");
    const label = variantLabel(r.variant);
    store.setAgentTrace({ kind: "select", variantId: r.variant.id, message: `Agent selected ${label}` });
    return {
      ok: true,
      variant: slimVariant(r.variant),
      ...(r.matched > 1 ? { matched_count: r.matched, note: `${r.matched} variants matched; selected the first in-stock one.` } : {}),
      message: `Selected ${label}${r.variant.available === false ? " (out of stock)" : ""}.`,
    };
  },

  async check_availability(args) {
    const p = product();
    if (!p) return fail("no_product", "This page has no product loaded yet.");
    const id = str(args.variant_id);
    if (!id) return fail("invalid_args", "variant_id is required.");
    const v = p.variants.find(x => String(x.id) === id);
    if (!v) return fail("not_found", `No variant with id "${id}". Call list_variants for valid ids.`);
    const base = { ok: true, variant_id: v.id, title: variantLabel(v), price: v.price };
    if (p.platform !== "shopify") {
      return {
        ...base,
        available: "unknown",
        reason: `no live inventory feed on this page; schema.org availability at extract time was ${p.availability}`,
        availability_at_extract: v.available,
      };
    }
    try {
      const fresh = await fetchExtractFresh(p.url);
      if (fresh.ok) {
        const live = fresh.product.variants.find(x => String(x.id) === id);
        if (live) {
          return { ...base, available: live.available === null ? "unknown" : live.available, price: live.price, source: "shopify live product feed", checked_at: new Date().toISOString(), cached: fresh.cached };
        }
        return { ...base, available: "unknown", reason: "variant no longer appears in the store's live product feed", checked_at: new Date().toISOString() };
      }
      return { ...base, available: v.available === null ? "unknown" : v.available, reason: `live refetch failed (${fresh.code}); showing availability at extract time ${p.extractedAt}`, live: false };
    } catch (err) {
      return { ...base, available: v.available === null ? "unknown" : v.available, reason: `live refetch failed (${(err as Error)?.message ?? "network"}); showing availability at extract time ${p.extractedAt}`, live: false };
    }
  },

  async ask_about_product(args) {
    const p = product();
    if (!p) return fail("no_product", "This page has no product loaded yet.");
    const question = str(args.question)?.trim();
    if (!question) return fail("invalid_args", "question is required.");
    let server: Awaited<ReturnType<typeof askServer>> = null;
    try { server = await askServer({ question, product: p }); } catch { server = null; }
    if (server && typeof server.answer === "string") {
      return { ok: true, question, answer: server.answer, mode: server.mode, grounded: true as const, sources: ["extracted product data"] };
    }
    const d = deterministicAnswer(p, question);
    return { ok: true, question, answer: d.answer, mode: d.mode, grounded: d.grounded, sources: d.sources };
  },

  async add_to_cart(args) {
    const p = product();
    if (!p) return fail("no_product", "This page has no product loaded yet.");
    const id = str(args.variant_id);
    if (!id) return fail("invalid_args", "variant_id is required. Call list_variants first.");
    const rawQty = args.quantity === undefined || args.quantity === null || args.quantity === "" ? 1 : Number(args.quantity);
    if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > 10) return fail("invalid_args", "quantity must be an integer from 1 to 10.");
    const v = p.variants.find(x => String(x.id) === id);
    if (!v) return fail("not_found", `No variant with id "${id}". Call list_variants for valid ids.`);
    if (v.available === false) return fail("unavailable", `${variantLabel(v)} is out of stock.`, { variant_id: v.id });
    const store = useStore.getState();
    const line: CartLine = { variantId: v.id, qty: rawQty, title: variantLabel(v), price: v.price };
    store.addToCart(line, "agent");
    const cart = useStore.getState().session.cart;
    const { url, note } = checkoutUrl(p, cart, v);
    const subtotal = Math.round(cart.reduce((sum, l) => sum + l.price.amount * l.qty, 0) * 100) / 100;
    store.setAgentTrace({ kind: "cart", variantId: v.id, message: `Agent added ${line.title} ×${rawQty} to cart` });
    return {
      ok: true,
      cart: { lines: cart.map(l => ({ variant_id: l.variantId, title: l.title, qty: l.qty, price: l.price })), count: cart.reduce((n, l) => n + l.qty, 0), subtotal: { amount: subtotal, currency: p.price.currency } },
      checkout_url: url,
      ...(note ? { note } : {}),
      message: `Added ${line.title} ×${rawQty} (${formatMoney(v.price)}) to the cart.${p.cart.kind === "shopify_permalink" ? " The checkout URL opens the store's cart with every line." : ""}`,
    };
  },

  async compare_with(args) {
    const a = product();
    if (!a) return fail("no_product", "This page has no product loaded yet.");
    const raw = str(args.url)?.trim();
    if (!raw) return fail("invalid_args", "url is required.");
    let u: URL;
    try { u = new URL(raw); } catch { return fail("invalid_args", "url must be an absolute https URL."); }
    if (u.protocol !== "https:") return fail("invalid_args", "Only https URLs are fetched.");
    let r: ExtractResult;
    try { r = await fetchExtract(u.toString()); } catch (err) { return fail("fetch_failed", `Could not fetch ${u.host}: ${(err as Error)?.message ?? "network error"}`); }
    if (!r.ok) return fail(r.code, r.error, { url: u.toString() });
    const b = r.product;
    const differences = diffProducts(a, b);
    const store = useStore.getState();
    store.setCompare({ a, b, differences, ts: new Date().toISOString() });
    store.setAgentTrace({ kind: "compare", message: `Agent compared with ${b.brand ? `${b.brand} ` : ""}${b.title}` });
    return {
      ok: true,
      a: slimProduct(a),
      b: slimProduct(b),
      differences,
      compare_url: `/compare?a=${encodeURIComponent(a.url)}&b=${encodeURIComponent(u.toString())}`,
      message: `Compared with ${b.title} (${b.host}). Opened the comparison on screen.`,
    };
  },

  async get_session_state() {
    const s = useStore.getState();
    const p = s.product;
    const selected = p?.variants.find(v => v.id === s.session.selectedVariantId);
    const cart = s.session.cart;
    return {
      ok: true,
      page_url: pageUrl(),
      product: p ? { id: p.id, title: p.title, brand: p.brand ?? null, url: p.canonicalUrl || p.url } : null,
      session: s.session,
      selected_variant: selected ? slimVariant(selected) : null,
      pinned: s.session.pinned.map(id => { const v = p?.variants.find(x => x.id === id); return v ? { variant_id: v.id, title: variantLabel(v) } : { variant_id: id }; }),
      cart: {
        lines: cart.map(l => ({ variant_id: l.variantId, title: l.title, qty: l.qty, price: l.price })),
        count: cart.reduce((n, l) => n + l.qty, 0),
        ...(p && cart.length ? { checkout_url: checkoutUrl(p, cart).url } : {}),
      },
      cart_mode: p?.cart.kind ?? null,
      human_actions: s.session.humanActions,
      last_tool_call: s.session.lastToolCall ?? null,
      policies: s.policy.tools,
      hide_compare_at_price: s.policy.hideCompareAtPrice,
      rate_limit_per_minute: s.policy.rateLimitPerMinute,
      agent_api: s.agentApi,
      registered_tools: s.registeredTools,
      ledger_entries: s.ledger.length,
    };
  },
};
