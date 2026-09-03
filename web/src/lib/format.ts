import type { Money, Variant } from "@shared/types";

/** "$139.00" · falls back to "139.00 USD" for currencies Intl does not know. */
export function formatMoney(m: Money | undefined | null): string {
  if (!m || typeof m.amount !== "number" || Number.isNaN(m.amount)) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: m.currency || "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(m.amount);
  } catch {
    return `${m.amount.toFixed(2)} ${m.currency ?? ""}`.trim();
  }
}

/** "Queen / White" — uses the variant title, else joins its option values. */
export function variantLabel(v: Pick<Variant, "title" | "options"> | undefined | null): string {
  if (!v) return "";
  if (v.title && v.title.trim()) return v.title.trim();
  const vals = Object.values(v.options ?? {}).filter(Boolean);
  return vals.length ? vals.join(" / ") : "Default";
}

/** Cut a string to `max` chars, ending with an ellipsis when cut. */
export function truncate(s: unknown, max = 140): string {
  const str = typeof s === "string" ? s : safeStringify(s);
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return typeof s === "string" ? s : String(v);
  } catch {
    return String(v);
  }
}

/** www.brooklinen.com → brooklinen.com */
export function hostLabel(host: string | undefined | null): string {
  return (host ?? "").replace(/^www\./, "");
}

/** Plain-English reason for an extraction error code. */
export function explainExtractError(code: string | undefined, fallback?: string): string {
  switch (code) {
    case "invalid_url": return "That is not a valid https product page URL.";
    case "ssrf_blocked": return "That address points at a private or local network, which this service does not fetch.";
    case "fetch_failed": return "The store did not answer, or answered with an error.";
    case "blocked_by_site": return "The store blocked the request. Some sites wall off automated readers.";
    case "no_product": return "No product data was found on that page. It needs Shopify product JSON or schema.org Product markup.";
    case "too_large": return "The page is larger than the 5 MB limit.";
    case "timeout": return "The store took longer than 8 seconds to answer.";
    default: return fallback || "Something went wrong while reading that page.";
  }
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
