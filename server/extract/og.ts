/**
 * Rung "og": OpenGraph / product:* meta, twitter labels, schema.org microdata (itemprop) and <title>.
 * Produces a single synthetic variant. Succeeds only when a price is present; a title alone is not a product page.
 */
import type { ParsedProduct } from "./types.js";
import { absUrl, availabilityFromSchema, canonicalFromDoc, decodeEntities, htmlToText, metaAll, metaContent, normalizeCurrency, parseDoc, parsePrice, type Doc, type El } from "./html.js";

function microdata(doc: Doc, base: string) {
  const scope = doc.querySelector('[itemtype*="schema.org/Product" i], [itemtype*="schema.org/IndividualProduct" i]');
  if (!scope) return null;
  const q = (prop: string) => scope.querySelector(`[itemprop="${prop}"]`);
  const val = (prop: string): string | undefined => {
    const el = q(prop);
    if (!el) return undefined;
    const v = el.getAttribute("content") ?? el.getAttribute("href") ?? el.getAttribute("src") ?? el.textContent;
    return v ? decodeEntities(v.trim()) : undefined;
  };
  const imgs: string[] = [];
  scope.querySelectorAll('[itemprop="image"]').forEach((el: El) => {
    const a = absUrl(el.getAttribute("content") ?? el.getAttribute("src") ?? el.getAttribute("href"), base);
    if (a) imgs.push(a);
  });
  const offer = scope.querySelector('[itemprop="offers"]') ?? scope;
  const ov = (prop: string): string | undefined => {
    const el = offer.querySelector(`[itemprop="${prop}"]`);
    if (!el) return undefined;
    const v = el.getAttribute("content") ?? el.getAttribute("href") ?? el.textContent;
    return v ? decodeEntities(v.trim()) : undefined;
  };
  return {
    name: val("name"),
    brand: val("brand"),
    description: val("description"),
    sku: val("sku"),
    images: imgs,
    price: parsePrice(ov("price") ?? ov("lowPrice")),
    currency: normalizeCurrency(ov("priceCurrency")),
    available: availabilityFromSchema(ov("availability")),
  };
}

export function parseOg(html: string, pageUrl: string, doc?: Doc): ParsedProduct | null {
  const d = doc ?? parseDoc(html);
  const md = microdata(d, pageUrl);
  const ogType = (metaContent(d, "og:type") ?? "").toLowerCase();

  const title =
    md?.name ??
    metaContent(d, "og:title") ??
    metaContent(d, "twitter:title") ??
    (d.querySelector("title")?.textContent ?? "").trim().replace(/\s*[|–-]\s*[^|–-]{1,40}$/, "") ??
    undefined;
  if (!title) return null;

  // Price: product:* meta → og:price → twitter label/data pairs → microdata.
  let price = parsePrice(metaContent(d, "product:price:amount") ?? metaContent(d, "og:price:amount") ?? metaContent(d, "product:sale_price:amount"));
  let currency = normalizeCurrency(metaContent(d, "product:price:currency") ?? metaContent(d, "og:price:currency") ?? metaContent(d, "product:sale_price:currency"));
  if (price === undefined) {
    for (const i of [1, 2]) {
      const label = (metaContent(d, `twitter:label${i}`) ?? "").toLowerCase();
      if (label.includes("price")) {
        const data = metaContent(d, `twitter:data${i}`);
        price = parsePrice(data);
        if (!currency) {
          const m = /([A-Z]{3})/.exec(data ?? "");
          currency = normalizeCurrency(m?.[1]) ?? normalizeCurrency((data ?? "").trim()[0]);
        }
      }
    }
  }
  if (price === undefined && md?.price !== undefined) {
    price = md.price;
    currency = currency ?? md.currency;
  }
  if (price === undefined) return null;

  const compareAt = parsePrice(metaContent(d, "product:original_price:amount"));
  const availabilityRaw = metaContent(d, "og:availability") ?? metaContent(d, "product:availability");
  const available = availabilityRaw ? availabilityFromSchema(availabilityRaw) : (md?.available ?? null);

  const images = [
    ...metaAll(d, "og:image:secure_url"),
    ...metaAll(d, "og:image"),
    ...metaAll(d, "twitter:image"),
    ...(md?.images ?? []),
  ]
    .map((i) => absUrl(i, pageUrl))
    .filter(Boolean) as string[];

  const description = md?.description ?? metaContent(d, "og:description") ?? metaContent(d, "description") ?? metaContent(d, "twitter:description") ?? "";
  const brand = metaContent(d, "product:brand") ?? md?.brand ?? metaContent(d, "og:brand");
  const sku = metaContent(d, "product:retailer_item_id") ?? metaContent(d, "product:retailer_part_no") ?? md?.sku;
  const warnings: string[] = [];
  if (!ogType.startsWith("product") && !md) warnings.push("page did not declare og:type=product; read from generic meta tags");
  const specs: Record<string, string> = {};
  const condition = metaContent(d, "product:condition");
  if (condition) specs.Condition = condition;
  const color = metaContent(d, "product:color");
  if (color) specs.Color = color;
  const material = metaContent(d, "product:material");
  if (material) specs.Material = material;

  return {
    id: sku,
    title: decodeEntities(title),
    brand,
    description: htmlToText(description),
    images,
    variants: [
      {
        id: sku,
        options: color ? { Color: color } : {},
        price,
        currency,
        compareAtPrice: compareAt !== undefined && compareAt > price ? compareAt : undefined,
        available,
        sku,
      },
    ],
    specs,
    canonicalUrl: canonicalFromDoc(d, pageUrl),
    currency,
    warnings,
  };
}
