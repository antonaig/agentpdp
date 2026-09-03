/** Small HTML helpers shared by the rungs. linkedom gives us a DOM; a few regex helpers cover the cases where the markup is too broken to parse. */
import { parseHTML } from "linkedom";

export type Doc = ReturnType<typeof parseHTML>["document"];
/** Minimal element surface we rely on from linkedom (its NodeList callbacks are untyped). */
export interface El {
  getAttribute(name: string): string | null;
  textContent: string | null;
  querySelector(sel: string): El | null;
  querySelectorAll(sel: string): { forEach(cb: (el: El) => void): void };
}

export function parseDoc(html: string): Doc {
  return parseHTML(html).document;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    const key = e.toLowerCase();
    if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return ENTITIES[key] ?? m;
  });
}

/** HTML → readable plain text. Block elements become newlines, list items become "- " lines. */
export function htmlToText(html: string | undefined | null, cap = 4000): string {
  if (!html) return "";
  let t = String(html);
  if (!/<[a-z!/]/i.test(t)) return collapse(decodeEntities(t), cap);
  t = t.replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<!--[\s\S]*?-->/g, " ");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<li[^>]*>/gi, "\n- ");
  t = t.replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|table|section|article|blockquote|dd|dt)>/gi, "\n");
  t = t.replace(/<(p|div|h[1-6]|tr|section|article|blockquote)[^>]*>/gi, "\n");
  t = t.replace(/<\/t[dh]>/gi, " \t");
  t = t.replace(/<[^>]+>/g, " ");
  return collapse(decodeEntities(t), cap);
}

function collapse(t: string, cap: number): string {
  const out = t
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out.length > cap ? out.slice(0, cap - 1).trimEnd() + "…" : out;
}

export function absUrl(u: string | undefined | null, base: string): string | undefined {
  if (!u) return undefined;
  let s = String(u).trim();
  if (!s) return undefined;
  if (s.startsWith("//")) s = "https:" + s;
  try {
    const abs = new URL(s, base);
    if (abs.protocol === "http:") abs.protocol = "https:";
    if (abs.protocol !== "https:") return undefined;
    return abs.href;
  } catch {
    return undefined;
  }
}

export function canonicalFromDoc(doc: Doc, base: string): string | undefined {
  const link = doc.querySelector('link[rel="canonical"]');
  const href = link?.getAttribute("href");
  return absUrl(href, base) ?? absUrl(metaContent(doc, "og:url"), base);
}

export function metaContent(doc: Doc, key: string): string | undefined {
  const el =
    doc.querySelector(`meta[property="${key}"]`) ??
    doc.querySelector(`meta[name="${key}"]`) ??
    doc.querySelector(`meta[itemprop="${key}"]`);
  const c = el?.getAttribute("content");
  return c ? decodeEntities(c.trim()) : undefined;
}

export function metaAll(doc: Doc, key: string): string[] {
  const out: string[] = [];
  doc.querySelectorAll(`meta[property="${key}"], meta[name="${key}"]`).forEach((el: El) => {
    const c = el.getAttribute("content");
    if (c) out.push(decodeEntities(c.trim()));
  });
  return out;
}

/** Parse "1,299.00", "$49", "49,90 €" → number. Returns undefined when nothing numeric is present. */
export function parsePrice(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let s = v.replace(/[^\d.,-]/g, "");
  if (!s) return undefined;
  // "1.299,00" (EU) vs "1,299.00" (US): the last separator is the decimal one when followed by exactly 2 digits.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot && s.length - lastComma === 3) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeCurrency(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(s)) return s;
  const symbols: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₪": "ILS", "₹": "INR", "C$": "CAD", "A$": "AUD" };
  return symbols[s];
}

/** schema.org availability URL or bare token → tri-state. */
export function availabilityFromSchema(v: unknown): boolean | null {
  if (typeof v !== "string") return null;
  const t = v.toLowerCase().replace(/^https?:\/\/schema\.org\//, "").replace(/^schema:/, "");
  if (["instock", "in_stock", "in stock", "instoreonly", "onlineonly", "limitedavailability", "available", "preorder", "presale", "backorder"].includes(t)) return true;
  if (["outofstock", "out_of_stock", "out of stock", "soldout", "sold out", "discontinued", "unavailable"].includes(t)) return false;
  return null;
}

/** Best-effort currency discovery in raw HTML for platforms whose product feed omits it (Shopify .js). */
export function sniffCurrency(html: string): string | undefined {
  const patterns = [
    /Shopify\.currency\s*=\s*\{\s*"active"\s*:\s*"([A-Z]{3})"/,
    /"priceCurrency"\s*:\s*"([A-Z]{3})"/,
    /property="(?:product|og):price:currency"\s+content="([A-Z]{3})"/,
    /content="([A-Z]{3})"\s+property="(?:product|og):price:currency"/,
    /"currencyCode"\s*:\s*"([A-Z]{3})"/,
    /"currency"\s*:\s*"([A-Z]{3})"/,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return m[1];
  }
  return undefined;
}
