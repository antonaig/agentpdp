import type { ExtractResult, Product, Variant } from "@shared/types";

/**
 * DEV-only fixture. Used by the product page ONLY when `/api/extract` answers 501 (extractor not landed yet)
 * AND `import.meta.env.DEV` is true. Never shipped as real data: the host is a reserved .test domain.
 */

const svgImage = (label: string, from: string, to: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/><text x="40" y="760" font-family="ui-sans-serif,system-ui" font-size="28" fill="rgba(0,0,0,.45)">${label}</text></svg>`,
  )}`;

const BASE = "https://example-store.test";
const HANDLE = "meridian-linen-duvet-cover";

function variant(id: string, size: string, color: string, amount: number, available: boolean, compareAt?: number): Variant {
  return {
    id,
    title: `${size} / ${color}`,
    options: { Size: size, Color: color },
    price: { amount, currency: "USD" },
    compareAtPrice: compareAt ? { amount: compareAt, currency: "USD" } : undefined,
    available,
    sku: `MER-${size.slice(0, 2).toUpperCase()}-${color.slice(0, 2).toUpperCase()}`,
    imageUrl: svgImage(`${size} / ${color}`, color === "White" ? "#f4f1ea" : "#d9c6a5", color === "White" ? "#d8d4c9" : "#b39a6e"),
    url: `${BASE}/products/${HANDLE}?variant=${id}`,
  };
}

export const MOCK_PRODUCT: Product = {
  id: "8000000001",
  url: `${BASE}/products/${HANDLE}`,
  canonicalUrl: `${BASE}/products/${HANDLE}`,
  host: "example-store.test",
  brand: "Meridian",
  title: "Linen Duvet Cover",
  description:
    "A duvet cover in 100% European flax linen, stonewashed for a soft hand from the first night. " +
    "Hidden button closure along the bottom edge and four interior corner ties keep the duvet in place. " +
    "Linen sleeps cool in summer and holds warmth in winter. Machine wash cold on a gentle cycle, tumble dry low, and skip the bleach. " +
    "Each cover ships in a reusable cotton bag. Sold as the cover only; pillowcases are sold separately.",
  images: [
    svgImage("Linen Duvet Cover — White", "#f4f1ea", "#d8d4c9"),
    svgImage("Linen Duvet Cover — Sand", "#d9c6a5", "#b39a6e"),
    svgImage("Detail — button closure", "#e9e4d8", "#c9c2b4"),
    svgImage("Detail — corner ties", "#ece7dc", "#cfc7b8"),
  ],
  price: { amount: 139, currency: "USD" },
  compareAtPrice: { amount: 169, currency: "USD" },
  priceRange: { min: { amount: 119, currency: "USD" }, max: { amount: 159, currency: "USD" } },
  options: [
    { name: "Size", values: ["Twin", "Queen", "King"] },
    { name: "Color", values: ["White", "Sand"] },
  ],
  variants: [
    variant("41000000001", "Twin", "White", 119, true),
    variant("41000000002", "Twin", "Sand", 119, true),
    variant("41000000003", "Queen", "White", 139, true, 169),
    variant("41000000004", "Queen", "Sand", 139, true, 169),
    variant("41000000005", "King", "White", 159, true),
    variant("41000000006", "King", "Sand", 159, false),
  ],
  specs: {
    Material: "100% European flax linen, 165 gsm",
    Closure: "Hidden buttons, bottom edge",
    "Corner ties": "4 interior ties",
    "Queen dimensions": '90" × 92"',
    "King dimensions": '104" × 92"',
    Care: "Machine wash cold, tumble dry low, no bleach",
    Origin: "Woven and sewn in Portugal",
  },
  rating: { value: 4.7, count: 212 },
  availability: "in_stock",
  platform: "shopify",
  cart: { kind: "shopify_permalink", base: BASE },
  extractedAt: new Date().toISOString(),
};

/** What `/api/extract` would have returned for the fixture. `requestedUrl` is kept in a warning so the page stays honest. */
export function mockExtractResult(requestedUrl?: string): ExtractResult {
  return {
    ok: true,
    source: "shopify",
    product: { ...MOCK_PRODUCT, extractedAt: new Date().toISOString() },
    warnings: [
      `DEV fixture — the extractor answered 501, so this is sample data for a fictional store${requestedUrl ? `, not ${requestedUrl}` : ""}.`,
    ],
    fetchedMs: 0,
    cached: false,
  };
}
