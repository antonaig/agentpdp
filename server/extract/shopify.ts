/**
 * Rung "shopify": detect a Shopify PDP and read the storefront product feed.
 *
 * `${origin}/products/${handle}.js` is primary (it carries `available`, option values and images; prices are in cents).
 * `${origin}/products/${handle}.json` is the alternate (prices as decimal strings, no `available`).
 * Currency comes from `${origin}/meta.json` (store-level) or, for .json, `variants[].price_currency`.
 */
import type { CartMode } from "../../shared/types.js";
import type { ParsedProduct, ParsedVariant } from "./types.js";
import { canonicalFromDoc, parseDoc, sniffCurrency, absUrl } from "./html.js";
import type { SafeFetchResult } from "./fetch.js";

export interface ShopifyTarget {
  origin: string;
  handle: string;
}

const HANDLE_RE = /\/products\/([a-z0-9][a-z0-9._-]*)(?:[/?#.]|$)/i;

/** URL-based detection: /products/<handle>, with or without locale (/en-us/) or collection (/collections/x/) prefixes. */
export function shopifyTargetFromUrl(input: string): ShopifyTarget | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  const m = HANDLE_RE.exec(u.pathname);
  if (!m) return null;
  const handle = m[1].replace(/\.(js|json)$/i, "");
  if (!handle) return null;
  return { origin: u.origin, handle };
}

/** HTML-marker detection: Shopify assets/theme globals + canonical link to a /products/ URL. */
export function shopifyTargetFromHtml(html: string, baseUrl: string): ShopifyTarget | null {
  if (!/cdn\.shopify\.com|Shopify\.theme|shopify-section|myshopify\.com|window\.Shopify\b/i.test(html)) return null;
  const doc = parseDoc(html);
  const canonical = canonicalFromDoc(doc, baseUrl);
  const fromCanonical = canonical ? shopifyTargetFromUrl(canonical) : null;
  if (fromCanonical) return fromCanonical;
  const alt = doc.querySelector('link[rel="alternate"][type="application/json+oembed"], meta[property="og:url"]');
  const href = alt?.getAttribute("href") ?? alt?.getAttribute("content");
  return href ? shopifyTargetFromUrl(absUrl(href, baseUrl) ?? "") : null;
}

/** Locale-prefixed storefronts (skims.com/en-il/products/x) serve the feed at the same prefix; try both. */
export function feedUrls(target: ShopifyTarget, pageUrl: string): { js: string[]; json: string[] } {
  const prefixes = new Set<string>([""]);
  try {
    const path = new URL(pageUrl).pathname;
    const m = /^(\/[a-z]{2}(?:-[a-z]{2})?)\/(?:collections\/[^/]+\/)?products\//i.exec(path);
    if (m) prefixes.add(m[1]);
  } catch {
    // ignore
  }
  const p = [...prefixes];
  return {
    js: p.map((pre) => `${target.origin}${pre}/products/${target.handle}.js`),
    json: p.map((pre) => `${target.origin}${pre}/products/${target.handle}.json`),
  };
}

type Json = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined;
}

/**
 * Normalize either feed shape into a ParsedProduct.
 * .js: prices are integers in cents, `available` present, `images` are protocol-relative strings, `description` is html.
 * .json: wrapped in { product }, prices are decimal strings, `body_html`, `images` are objects, no `available`.
 */
export function parseShopifyFeed(raw: unknown, target: ShopifyTarget, opts: { storeCurrency?: string; pageUrl?: string } = {}): ParsedProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Json;
  const isJsonShape = "product" in root && typeof root.product === "object";
  const p = (isJsonShape ? (root.product as Json) : root) ?? {};
  const title = str(p.title);
  if (!title || !Array.isArray(p.variants)) return null;

  const warnings: string[] = [];
  const cents = !isJsonShape; // .js prices are in cents
  const toAmount = (v: unknown): number | undefined => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(n)) return undefined;
    return cents ? n / 100 : n;
  };

  // Options: .js and .json both have [{name, position, values}]; very old .js themes have ["Size","Color"].
  const optionDefs: { name: string; values: string[] }[] = [];
  if (Array.isArray(p.options)) {
    for (const o of p.options as unknown[]) {
      if (typeof o === "string") optionDefs.push({ name: o, values: [] });
      else if (o && typeof o === "object" && str((o as Json).name)) {
        const vals = Array.isArray((o as Json).values) ? ((o as Json).values as unknown[]).map(String) : [];
        optionDefs.push({ name: str((o as Json).name)!, values: vals });
      }
    }
  }

  const images: string[] = [];
  if (Array.isArray(p.images)) {
    for (const im of p.images as unknown[]) {
      const src = typeof im === "string" ? im : im && typeof im === "object" ? str((im as Json).src) : undefined;
      if (src) images.push(src.startsWith("//") ? `https:${src}` : src);
    }
  }
  if (images.length === 0) {
    const fi = p.featured_image ?? (p.image && typeof p.image === "object" ? (p.image as Json).src : undefined);
    const src = str(fi);
    if (src) images.push(src.startsWith("//") ? `https:${src}` : src);
  }

  let variantCurrency: string | undefined;
  const variants: ParsedVariant[] = [];
  for (const v of p.variants as unknown[]) {
    if (!v || typeof v !== "object") continue;
    const vj = v as Json;
    const options: Record<string, string> = {};
    for (let i = 0; i < 3; i++) {
      const val = str(vj[`option${i + 1}`]);
      if (!val) continue;
      const name = optionDefs[i]?.name ?? `Option ${i + 1}`;
      options[name] = val;
      if (optionDefs[i] && !optionDefs[i].values.includes(val)) optionDefs[i].values.push(val);
    }
    const fiObj = vj.featured_image && typeof vj.featured_image === "object" ? (vj.featured_image as Json) : undefined;
    const fiSrc = str(fiObj?.src);
    const pc = str(vj.price_currency);
    if (pc && /^[A-Z]{3}$/.test(pc)) variantCurrency = pc;
    const id = str(vj.id);
    const price = toAmount(vj.price);
    const variant: ParsedVariant = {
      id,
      title: str(vj.title) ?? str(vj.name),
      options,
      price,
      compareAtPrice: toAmount(vj.compare_at_price),
      available: typeof vj.available === "boolean" ? vj.available : null,
      sku: str(vj.sku),
      imageUrl: fiSrc ? (fiSrc.startsWith("//") ? `https:${fiSrc}` : fiSrc) : undefined,
      url: id ? `${target.origin}/products/${target.handle}?variant=${id}` : undefined,
    };
    variants.push(variant);
  }
  if (variants.every((v) => v.available === null)) warnings.push("feed did not include live availability (.json shape); availability unknown");

  const currency = variantCurrency ?? opts.storeCurrency;
  const cart: CartMode = { kind: "shopify_permalink", base: target.origin };
  const canonicalUrl = `${target.origin}/products/${target.handle}`;
  const description = str(p.body_html) ?? str(p.description);

  return {
    id: str(p.id),
    title,
    brand: str(p.vendor),
    description,
    images,
    options: optionDefs.filter((o) => !(o.name.toLowerCase() === "title" && o.values.every((x) => x.toLowerCase() === "default title"))),
    variants,
    specs: str(p.product_type) ? { Type: str(p.product_type)! } : undefined,
    canonicalUrl,
    currency,
    platform: "shopify",
    cart,
    warnings,
  };
}

/** Currency for a store: meta.json → sniff the page HTML → undefined. */
export function currencyFromMeta(metaText: string | undefined, html?: string): string | undefined {
  if (metaText) {
    try {
      const m = JSON.parse(metaText) as Json;
      const c = str(m.currency);
      if (c && /^[A-Z]{3}$/.test(c)) return c;
    } catch {
      // not json
    }
  }
  return html ? sniffCurrency(html) : undefined;
}

export function looksLikeJson(res: SafeFetchResult): boolean {
  const ct = res.headers["content-type"] ?? "";
  if (/json|javascript/i.test(ct)) return true;
  const t = res.text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}
