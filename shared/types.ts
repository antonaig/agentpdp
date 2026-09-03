/** Shared contract between server (extraction) and web (WebMCP tools + UI). Change with care: both sides import it. */

export type ExtractSource = "shopify" | "jsonld" | "og";

export interface Money { amount: number; currency: string }

export interface Variant {
  id: string;
  title: string;                       // e.g. "Queen / White"
  options: Record<string, string>;     // e.g. { Size: "Queen", Color: "White" }
  price: Money;
  compareAtPrice?: Money;
  available: boolean | null;           // null = unknown (no live inventory signal)
  sku?: string;
  imageUrl?: string;
  url?: string;                        // variant-specific PDP url if known
}

export type CartMode =
  | { kind: "shopify_permalink"; base: string }   // base = https://store.tld ; permalink = `${base}/cart/${variantId}:${qty}`
  | { kind: "pdp_link" };                        // no programmatic cart; agent gets the PDP url

export interface Product {
  id: string;
  url: string;                 // the URL the user pasted (normalized)
  canonicalUrl: string;
  host: string;                // e.g. www.brooklinen.com
  brand?: string;
  title: string;
  description: string;         // plain text
  images: string[];            // absolute https urls
  price: Money;                // representative price (selected/first available variant)
  compareAtPrice?: Money;
  priceRange?: { min: Money; max: Money };
  options: { name: string; values: string[] }[];
  variants: Variant[];         // at least one; single-variant products get one synthetic variant
  specs: Record<string, string>;
  rating?: { value: number; count?: number };
  availability: "in_stock" | "out_of_stock" | "unknown";
  platform: "shopify" | "unknown";
  cart: CartMode;
  extractedAt: string;         // ISO
}

export type ExtractErrorCode = "invalid_url" | "ssrf_blocked" | "fetch_failed" | "blocked_by_site" | "no_product" | "too_large" | "timeout";

export type ExtractResult =
  | { ok: true; source: ExtractSource; product: Product; warnings: string[]; fetchedMs: number; cached: boolean }
  | { ok: false; code: ExtractErrorCode; error: string };

// ---- WebMCP tools on a generated page ----
export const TOOL_NAMES = [
  "get_product",
  "list_variants",
  "select_variant",
  "check_availability",
  "ask_about_product",
  "add_to_cart",
  "compare_with",
  "get_session_state",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** on = agent may call freely · confirm = a human must tap to approve each call · off = tool is unregistered (invisible to agents) */
export type ToolPolicy = "on" | "confirm" | "off";

export interface PolicyState {
  tools: Record<ToolName, ToolPolicy>;
  hideCompareAtPrice: boolean;   // when true, compareAtPrice is stripped from tool responses
  rateLimitPerMinute: number;    // soft limit per page session; 0 = unlimited
}

export const DEFAULT_POLICY: PolicyState = {
  tools: {
    get_product: "on",
    list_variants: "on",
    select_variant: "on",
    check_availability: "on",
    ask_about_product: "on",
    add_to_cart: "confirm",
    compare_with: "on",
    get_session_state: "on",
  },
  hideCompareAtPrice: false,
  rateLimitPerMinute: 60,
};

export type LedgerOutcome = "ok" | "error" | "blocked" | "confirmed" | "denied" | "rate_limited";

export interface LedgerEntry {
  id: string;
  ts: string;                 // ISO
  tool: ToolName;
  args: unknown;
  outcome: LedgerOutcome;
  ms: number;
  resultSummary: string;      // one line, <= 140 chars
  agent: string;              // best-effort: "site-tools" (ChatGPT), "chrome-webmcp", "unknown", or navigator.userAgent slice
}

export interface CartLine { variantId: string; qty: number; title: string; price: Money }

export interface SessionState {
  selectedVariantId?: string;
  pinned: string[];           // variant ids the human pinned
  cart: CartLine[];
  lastToolCall?: string;      // ISO
  humanActions: number;       // clicks the human made on the page (selection/pin/cart)
}

// ---- /api/ask ----
export interface AskRequest { question: string; product: Product }
export interface AskResponse { answer: string; grounded: true; mode: "llm" | "deterministic" }
