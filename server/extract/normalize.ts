/** Turn a ParsedProduct (whatever a rung managed to read) into the Product contract from shared/types.ts. */
import { createHash } from "node:crypto";
import type { ExtractSource, Money, Product, Variant } from "../../shared/types.js";
import type { ParsedProduct, ParsedVariant } from "./types.js";
import { absUrl, htmlToText } from "./html.js";

export const DESCRIPTION_CAP = 4000;
const MAX_SPECS = 40;
const MAX_IMAGES = 24;

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|ref|_ga|_gl|srsltid|igshid|ttclid|yclid)/i;

/** Drop the hash and tracking parameters; keep everything that might identify the product or variant. */
export function normalizeUrl(input: string): string {
  const u = new URL(input);
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  if (u.protocol === "http:") u.protocol = "https:";
  return u.href;
}

/** Mine "Key: value" lines out of a plain-text description. Conservative: short keys, single line, no URLs. */
export function mineSpecs(text: string): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[-•*]\s*/, "").trim();
    const m = /^([A-Za-z][A-Za-z0-9 /&()'+.-]{1,40}?)\s*:\s+(.{1,200})$/.exec(line);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    if (/https?:\/\//i.test(val) || /^\d+$/.test(key)) continue;
    if (/^(note|warning|tip|step \d+|q|a|pro tip|disclaimer)$/i.test(key)) continue;
    if (!specs[key]) specs[key] = val;
    if (Object.keys(specs).length >= MAX_SPECS) break;
  }
  return specs;
}

function money(amount: number, currency: string): Money {
  return { amount: Math.round(amount * 100) / 100, currency };
}

function stableId(seed: string): string {
  return createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

export interface NormalizeContext {
  /** the URL the user pasted */
  inputUrl: string;
  /** where the fetch ended up */
  finalUrl: string;
  source: ExtractSource;
}

export function normalizeProduct(p: ParsedProduct, ctx: NormalizeContext): { product: Product; warnings: string[] } {
  const warnings = [...p.warnings];
  const url = normalizeUrl(ctx.inputUrl);
  const canonicalUrl = p.canonicalUrl ?? normalizeUrl(ctx.finalUrl);
  const host = new URL(canonicalUrl).host || new URL(url).host;
  const title = (p.title ?? "").trim() || "Untitled product";
  const productId = p.id?.trim() || stableId(canonicalUrl);

  // Currency: variant-level → product-level → assume USD with a warning. Never silently invent one.
  const currencies = new Set(p.variants.map((v) => v.currency).filter(Boolean) as string[]);
  let currency = p.currency ?? [...currencies][0];
  if (!currency) {
    currency = "USD";
    warnings.push("currency not stated by the page; assumed USD");
  }
  if (currencies.size > 1) warnings.push(`variants list more than one currency (${[...currencies].join(", ")}); using ${currency}`);

  const description = htmlToText(p.description, DESCRIPTION_CAP);

  // Variants: at least one. Drop entries with no price at all when others have one.
  let variants: Variant[] = [];
  const priced = p.variants.filter((v) => typeof v.price === "number");
  const pool = priced.length > 0 ? priced : p.variants;
  if (pool.length < p.variants.length) warnings.push(`${p.variants.length - pool.length} variant(s) without a price were dropped`);
  const seen = new Set<string>();
  pool.forEach((v, i) => {
    const vid = (v.id ?? "").trim() || (v.sku ?? "").trim() || `${productId}-${i + 1}`;
    const id = seen.has(vid) ? `${vid}-${i + 1}` : vid;
    seen.add(id);
    const opts = cleanOptions(v.options);
    const vt = (v.title ?? "").trim() || Object.values(opts).join(" / ") || title;
    const price = typeof v.price === "number" ? v.price : 0;
    if (typeof v.price !== "number") warnings.push(`variant "${vt}" has no price on the page; shown as 0`);
    const variant: Variant = { id, title: vt, options: opts, price: money(price, v.currency ?? currency), available: v.available };
    if (typeof v.compareAtPrice === "number" && v.compareAtPrice > price) variant.compareAtPrice = money(v.compareAtPrice, v.currency ?? currency);
    if (v.sku) variant.sku = v.sku;
    const img = absUrl(v.imageUrl, canonicalUrl);
    if (img) variant.imageUrl = img;
    const vurl = absUrl(v.url, canonicalUrl);
    if (vurl) variant.url = vurl;
    variants.push(variant);
  });
  if (variants.length === 0) {
    warnings.push("no variants found; created one synthetic variant");
    variants = [{ id: productId, title, options: {}, price: money(0, currency), available: null }];
  }

  // Options: platform order when given, else derived from the variants.
  const options = p.options && p.options.length > 0 ? p.options.map((o) => ({ name: o.name, values: uniq(o.values) })) : deriveOptions(variants);

  // Representative price: first available, else first.
  const rep = variants.find((v) => v.available === true) ?? variants[0];
  const amounts = variants.map((v) => v.price.amount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);

  const availability: Product["availability"] = variants.some((v) => v.available === true)
    ? "in_stock"
    : variants.every((v) => v.available === false)
      ? "out_of_stock"
      : "unknown";

  const images = uniq([
    ...p.images.map((i) => absUrl(i, canonicalUrl)).filter(Boolean) as string[],
    ...variants.map((v) => v.imageUrl).filter(Boolean) as string[],
  ]).slice(0, MAX_IMAGES);

  const specs: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.specs ?? {})) {
    const key = k.trim();
    const val = String(v).trim();
    if (key && val && Object.keys(specs).length < MAX_SPECS) specs[key] = val.slice(0, 300);
  }
  for (const [k, v] of Object.entries(mineSpecs(description))) {
    if (!specs[k] && Object.keys(specs).length < MAX_SPECS) specs[k] = v;
  }

  const product: Product = {
    id: productId,
    url,
    canonicalUrl,
    host,
    title,
    description,
    images,
    price: rep.price,
    options,
    variants,
    specs,
    availability,
    platform: ctx.source === "shopify" && p.platform === "shopify" ? "shopify" : "unknown",
    cart: p.cart ?? { kind: "pdp_link" },
    extractedAt: new Date().toISOString(),
  };
  if (p.brand?.trim()) product.brand = p.brand.trim();
  if (rep.compareAtPrice) product.compareAtPrice = rep.compareAtPrice;
  if (min !== max) product.priceRange = { min: money(min, currency), max: money(max, currency) };
  if (p.rating && Number.isFinite(p.rating.value)) product.rating = { value: p.rating.value, ...(p.rating.count !== undefined ? { count: p.rating.count } : {}) };
  return { product, warnings: uniq(warnings) };
}

function cleanOptions(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o ?? {})) {
    const key = k.trim();
    const val = String(v ?? "").trim();
    if (!key || !val) continue;
    if (key.toLowerCase() === "title" && val.toLowerCase() === "default title") continue;
    out[key] = val;
  }
  return out;
}

function deriveOptions(variants: Variant[]): { name: string; values: string[] }[] {
  const order: string[] = [];
  const values = new Map<string, string[]>();
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.options)) {
      if (!values.has(k)) {
        values.set(k, []);
        order.push(k);
      }
      const arr = values.get(k)!;
      if (!arr.includes(val)) arr.push(val);
    }
  }
  return order.map((name) => ({ name, values: values.get(name)! }));
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export type { ParsedVariant };
