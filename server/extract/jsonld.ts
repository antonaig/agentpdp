/**
 * Rung "jsonld": read schema.org Product / ProductGroup / Offer data from <script type="application/ld+json">.
 * Handles arrays, @graph, nested mainEntity, hasVariant, AggregateOffer, ImageObject images, Brand objects,
 * additionalProperty specs, aggregateRating, and lightly broken JSON (trailing commas, HTML comments).
 */
import type { ParsedProduct, ParsedVariant } from "./types.js";
import { availabilityFromSchema, canonicalFromDoc, htmlToText, normalizeCurrency, parseDoc, parsePrice, absUrl, stripHtmlComments, type Doc, type El } from "./html.js";

/** Script bodies past this are not product data; refusing them keeps the lenient passes linear in practice. */
export const MAX_JSONLD_CHARS = 1_000_000;

type Json = Record<string, unknown>;

export function extractJsonLdBlocks(html: string, doc?: Doc): unknown[] {
  const texts: string[] = [];
  try {
    const d = doc ?? parseDoc(html);
    d.querySelectorAll('script[type="application/ld+json"]').forEach((s: El) => {
      const t = s.textContent;
      if (t && t.trim()) texts.push(t);
    });
  } catch {
    // fall through to regex
  }
  if (texts.length === 0) {
    const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) if (m[1].trim()) texts.push(m[1]);
  }
  const out: unknown[] = [];
  for (const t of texts) {
    const parsed = lenientJsonParse(t);
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
}

export function lenientJsonParse(text: string): unknown {
  if (text.length > MAX_JSONLD_CHARS) return undefined;
  let t = text.trim();
  // CDATA wrappers and HTML comments occasionally appear inside the script body.
  t = stripHtmlComments(t).replace(/^\/\/\s*<!\[CDATA\[/, "").replace(/\/\/\s*\]\]>$/, "").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
  const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
  const attempts = [
    t,
    t.replace(/,\s*([}\]])/g, "$1"), // trailing commas
    t.replace(CONTROL, ""), // stray control chars
    t.replace(/,\s*([}\]])/g, "$1").replace(CONTROL, "").replace(/\\'/g, "'"),
  ];
  for (const a of attempts) {
    try {
      return JSON.parse(a);
    } catch {
      // next
    }
  }
  // Several objects concatenated: "{...}{...}" or "{...},{...}"
  if (t.startsWith("{") && t.endsWith("}") && /\}\s*,?\s*\{/.test(t)) {
    try {
      return JSON.parse(`[${t.replace(/\}\s*\{/g, "},{")}]`);
    } catch {
      // give up
    }
  }
  return undefined;
}

function types(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const t = (node as Json)["@type"];
  const arr = Array.isArray(t) ? t : t ? [t] : [];
  return arr.map((x) => String(x).replace(/^https?:\/\/schema\.org\//i, "").replace(/^schema:/i, "").toLowerCase());
}

function hasType(node: unknown, ...names: string[]): boolean {
  const ts = types(node);
  return names.some((n) => ts.includes(n.toLowerCase()));
}

function asArray<T = unknown>(v: unknown): T[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object") {
    const o = v as Json;
    return str(o.name) ?? str(o["@value"]) ?? str(o.value);
  }
  return undefined;
}

/** Walk the whole document collecting Product-like nodes. */
export function collectProductNodes(blocks: unknown[]): Json[] {
  const found: Json[] = [];
  const seen = new Set<unknown>();
  const visit = (node: unknown, depth: number, insideList: boolean) => {
    if (!node || typeof node !== "object" || depth > 8 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1, insideList));
      return;
    }
    const o = node as Json;
    if (hasType(o, "Product", "ProductGroup", "ProductModel", "IndividualProduct", "SomeProducts", "Vehicle", "Book")) {
      // Mark list members so the picker can de-prioritize "related products" carousels.
      found.push(insideList ? { ...o, __inList: true } : o);
    }
    const list = hasType(o, "ItemList", "BreadcrumbList") || insideList;
    for (const [k, v] of Object.entries(o)) {
      if (k === "hasVariant" || k === "isVariantOf" || k === "offers") continue; // handled per product
      if (v && typeof v === "object") visit(v, depth + 1, list || k === "itemListElement");
    }
  };
  blocks.forEach((b) => visit(b, 0, false));
  return found;
}

function nodeUrl(o: Json): string | undefined {
  return str(o.url) ?? (typeof o["@id"] === "string" && /^https?:/.test(o["@id"]) ? (o["@id"] as string) : undefined);
}

/** Choose the node most likely to be *this* page's product. */
export function pickProductNode(nodes: Json[], pageUrl: string): Json | undefined {
  if (nodes.length === 0) return undefined;
  const norm = (u?: string) => (u ? u.replace(/^https?:\/\//, "").replace(/\/$/, "").split(/[?#]/)[0].toLowerCase() : "");
  const page = norm(pageUrl);
  const score = (o: Json): number => {
    let s = 0;
    if (hasType(o, "ProductGroup") && asArray(o.hasVariant).length > 0) s += 6;
    if (o.offers) s += 4;
    if (o.name) s += 2;
    if (o.image) s += 1;
    if (o.description) s += 1;
    const u = norm(nodeUrl(o));
    if (u && page && (u === page || page.endsWith(u) || u.endsWith(page))) s += 5;
    if (o.__inList) s -= 5;
    if (o.isVariantOf) s -= 1; // a variant node; the group (if present) is better
    return s;
  };
  return [...nodes].sort((a, b) => score(b) - score(a))[0];
}

function images(v: unknown, base: string): string[] {
  const out: string[] = [];
  for (const item of asArray(v)) {
    if (typeof item === "string") {
      const a = absUrl(item, base);
      if (a) out.push(a);
    } else if (item && typeof item === "object") {
      const o = item as Json;
      const a = absUrl(str(o.url) ?? str(o.contentUrl) ?? str(o["@id"]), base);
      if (a) out.push(a);
    }
  }
  return out;
}

interface OfferInfo {
  price?: number;
  currency?: string;
  compareAtPrice?: number;
  available: boolean | null;
  sku?: string;
  url?: string;
  name?: string;
  itemOffered?: Json;
  low?: number;
  high?: number;
  image?: string;
}

function readOffer(o: Json, base: string): OfferInfo {
  const info: OfferInfo = { available: availabilityFromSchema(o.availability) };
  let price = parsePrice(o.price);
  let currency = normalizeCurrency(o.priceCurrency);
  for (const ps of asArray<Json>(o.priceSpecification)) {
    if (!ps || typeof ps !== "object") continue;
    const p = parsePrice(ps.price);
    const c = normalizeCurrency(ps.priceCurrency);
    const isStrike = /listprice|strikethrough|regular/i.test(String(ps.priceType ?? "") + String(ps.name ?? ""));
    if (isStrike && p !== undefined) info.compareAtPrice = p;
    else {
      if (price === undefined && p !== undefined) price = p;
      if (!currency && c) currency = c;
    }
  }
  if (hasType(o, "AggregateOffer")) {
    info.low = parsePrice(o.lowPrice);
    info.high = parsePrice(o.highPrice);
    if (price === undefined) price = info.low;
  }
  info.price = price;
  info.currency = currency;
  info.sku = str(o.sku) ?? str(o.mpn) ?? str(o.gtin13) ?? str(o.gtin);
  info.url = absUrl(str(o.url), base);
  info.name = str(o.name);
  info.image = images(o.image, base)[0];
  if (o.itemOffered && typeof o.itemOffered === "object") info.itemOffered = o.itemOffered as Json;
  return info;
}

function flattenOffers(v: unknown): Json[] {
  const out: Json[] = [];
  for (const o of asArray<Json>(v)) {
    if (!o || typeof o !== "object") continue;
    if (hasType(o, "AggregateOffer") && asArray(o.offers).length > 0) {
      out.push(o); // keep the aggregate for currency / range
      out.push(...flattenOffers(o.offers));
    } else out.push(o);
  }
  return out;
}

function variantOptions(node: Json): Record<string, string> {
  const opts: Record<string, string> = {};
  for (const key of ["color", "size", "material", "pattern", "width", "height", "depth", "weight"] as const) {
    const v = node[key];
    const s = typeof v === "object" && v ? str((v as Json).value ?? (v as Json).name) : str(v);
    if (s && s.length <= 60 && (key === "color" || key === "size")) opts[key[0].toUpperCase() + key.slice(1)] = s;
  }
  for (const ap of asArray<Json>(node.additionalProperty)) {
    const n = str(ap?.name);
    const v = str(ap?.value);
    if (n && v && /^(size|color|colour|fit|length|width|capacity|style)$/i.test(n) && !opts[n]) opts[n[0].toUpperCase() + n.slice(1)] = v;
  }
  return opts;
}

function specsFrom(node: Json): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const ap of asArray<Json>(node.additionalProperty)) {
    const n = str(ap?.name);
    const v = str(ap?.value);
    if (n && v) specs[n] = v;
  }
  for (const key of ["material", "color", "pattern", "category", "sku", "mpn", "gtin13", "gtin", "productID", "model", "countryOfOrigin", "size"]) {
    const v = node[key];
    const s = typeof v === "object" && v ? str((v as Json).name ?? (v as Json).value) : str(v);
    if (s && s.length <= 200) specs[key === "gtin13" ? "GTIN" : key[0].toUpperCase() + key.slice(1)] = s;
  }
  for (const key of ["weight", "width", "height", "depth"]) {
    const v = node[key];
    if (v && typeof v === "object") {
      const q = v as Json;
      const val = str(q.value);
      const unit = str(q.unitText) ?? str(q.unitCode);
      if (val) specs[key[0].toUpperCase() + key.slice(1)] = unit ? `${val} ${unit}` : val;
    } else if (str(v)) specs[key[0].toUpperCase() + key.slice(1)] = str(v)!;
  }
  return specs;
}

/** Shopify storefronts (also headless ones) link variants as ...?variant=<numeric id>; that id drives the cart permalink. */
export function shopifyVariantId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = /[?&]variant=(\d{6,})/.exec(url);
  return m?.[1];
}

function brandOf(v: unknown): string | undefined {
  for (const b of asArray(v)) {
    const s = str(b);
    if (s) return s;
  }
  return undefined;
}

/** Convert a picked Product/ProductGroup node into a ParsedProduct. */
export function productFromNode(node: Json, base: string): ParsedProduct | null {
  const title = str(node.name) ?? str(node.title);
  if (!title) return null;
  const warnings: string[] = [];
  const variants: ParsedVariant[] = [];
  const productCurrency = normalizeCurrency(node.priceCurrency);
  const groupSpecs = specsFrom(node);
  const groupOffers = flattenOffers(node.offers).map((o) => readOffer(o, base));
  const aggregate = groupOffers.find((o) => o.low !== undefined || o.high !== undefined);

  // ProductGroup → hasVariant[] each a Product with its own offers
  const allVariantNodes = asArray<Json>(node.hasVariant).filter((v) => v && typeof v === "object");
  // Link-only stubs ({ url }) point at sibling products (other colorways); they are not variants of this page.
  const variantNodes = allVariantNodes.filter((v) => v.offers || v.sku || v.name || v.size || v.color);
  if (variantNodes.length < allVariantNodes.length) warnings.push(`${allVariantNodes.length - variantNodes.length} linked sibling product(s) (other colorways) not included as variants`);
  for (const vn of variantNodes) {
    const offers = flattenOffers(vn.offers).map((o) => readOffer(o, base));
    const primary = offers.find((o) => o.price !== undefined) ?? offers[0];
    const opts = variantOptions(vn);
    variants.push({
      id: shopifyVariantId(primary?.url) ?? str(vn.sku) ?? str(vn.mpn) ?? str(vn.productID) ?? primary?.sku ?? str(vn.gtin) ?? str(vn["@id"]),
      title: str(vn.name) !== title ? str(vn.name) : undefined,
      options: opts,
      price: primary?.price,
      currency: primary?.currency ?? productCurrency,
      compareAtPrice: primary?.compareAtPrice,
      available: primary ? primary.available : null,
      sku: str(vn.sku) ?? primary?.sku,
      imageUrl: images(vn.image, base)[0] ?? primary?.image,
      url: absUrl(str(vn.url), base) ?? primary?.url,
    });
    Object.assign(groupSpecs, {}); // variant-level specs stay on variants
  }

  // Plain Product with one or many Offers
  if (variants.length === 0) {
    const concrete = groupOffers.filter((o) => o.low === undefined && o.high === undefined);
    if (concrete.length > 1) {
      concrete.forEach((o, i) => {
        const io = o.itemOffered;
        const opts = io ? variantOptions(io) : {};
        variants.push({
          id: shopifyVariantId(o.url) ?? o.sku ?? (io ? str(io.sku) : undefined) ?? `offer-${i + 1}`,
          title: o.name ?? (io ? str(io.name) : undefined),
          options: opts,
          price: o.price,
          currency: o.currency ?? productCurrency ?? aggregate?.currency,
          compareAtPrice: o.compareAtPrice,
          available: o.available,
          sku: o.sku ?? (io ? str(io.sku) : undefined),
          imageUrl: o.image ?? (io ? images(io.image, base)[0] : undefined),
          url: o.url,
        });
      });
    } else {
      const o = concrete[0] ?? aggregate;
      const opts = variantOptions(node);
      if (o || Object.keys(opts).length > 0) {
        variants.push({
          id: shopifyVariantId(o?.url) ?? str(node.sku) ?? str(node.productID) ?? o?.sku,
          options: opts,
          price: o?.price ?? aggregate?.low,
          currency: o?.currency ?? productCurrency ?? aggregate?.currency,
          compareAtPrice: o?.compareAtPrice,
          available: o ? o.available : null,
          sku: str(node.sku) ?? o?.sku,
          url: o?.url,
        });
      }
    }
  }

  if (aggregate && (aggregate.low !== undefined || aggregate.high !== undefined) && variants.length <= 1) {
    warnings.push(`page lists a price range ${aggregate.low ?? "?"}–${aggregate.high ?? "?"} without per-variant prices`);
  }

  let rating: ParsedProduct["rating"];
  const ar = node.aggregateRating && typeof node.aggregateRating === "object" ? (node.aggregateRating as Json) : undefined;
  if (ar) {
    const value = parsePrice(ar.ratingValue);
    const count = parsePrice(ar.reviewCount ?? ar.ratingCount);
    if (value !== undefined) rating = { value, ...(count !== undefined ? { count } : {}) };
  }

  const canonical = absUrl(nodeUrl(node), base);
  return {
    id: str(node.productID) ?? str(node.sku) ?? undefined,
    title,
    brand: brandOf(node.brand) ?? brandOf(node.manufacturer),
    description: htmlToText(str(node.description)),
    images: images(node.image, base),
    variants,
    specs: groupSpecs,
    rating,
    canonicalUrl: canonical && !canonical.includes("#") ? canonical : undefined,
    currency: productCurrency ?? aggregate?.currency,
    warnings,
  };
}

/** Full rung: html → ParsedProduct | null (null = no usable Product node). */
export function parseJsonLd(html: string, pageUrl: string, doc?: Doc): ParsedProduct | null {
  const d = doc ?? parseDoc(html);
  const blocks = extractJsonLdBlocks(html, d);
  if (blocks.length === 0) return null;
  const nodes = collectProductNodes(blocks);
  const node = pickProductNode(nodes, pageUrl);
  if (!node) return null;
  const parsed = productFromNode(node, pageUrl);
  if (!parsed) return null;
  if (!parsed.canonicalUrl) parsed.canonicalUrl = canonicalFromDoc(d, pageUrl);
  // Headless Shopify storefront (feed 404s, but JSON-LD links variants by Shopify id): a real cart permalink still works.
  const shopifyMarkers = /cdn\.shopify\.com|myshopify\.com|Shopify\.theme|shopify-section/i.test(html);
  const allShopifyIds = parsed.variants.length > 0 && parsed.variants.every((v) => v.id && /^\d{6,}$/.test(v.id) && v.url && /[?&]variant=/.test(v.url));
  if (shopifyMarkers && allShopifyIds) {
    parsed.cart = { kind: "shopify_permalink", base: new URL(pageUrl).origin };
    parsed.warnings.push("cart permalink inferred from Shopify variant ids in the page's JSON-LD (product feed not exposed)");
  }
  return parsed;
}
