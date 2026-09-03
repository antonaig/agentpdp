export interface ExampleUrl {
  label: string;   // short chip text
  url: string;     // the real product page
  note: string;    // what makes it a good demo
}

/**
 * Real product pages, verified live on 2026-09-04 with `server/scripts/matrix.ts` (nothing mocked).
 * Mix of extraction paths so the demo shows the ladder: Shopify feed, schema.org JSON-LD, and a headless render
 * through a Cloudflare challenge. Keep this the one place example URLs live.
 */
export const EXAMPLE_URLS: ExampleUrl[] = [
  { label: "Brooklinen · Luxe Sateen sheet set", url: "https://www.brooklinen.com/products/luxe-core-sheet-set", note: "Shopify feed · Color × Size, 174 variants · real cart link" },
  { label: "Allbirds · Women's Dasher NZ", url: "https://www.allbirds.com/products/womens-dasher-nz-blizzard-deep-navy", note: "Shopify feed · 13 sizes · real cart link" },
  { label: "SKIMS · Fits Everybody T-shirt bra", url: "https://skims.com/products/fits-everybody-t-shirt-bra-onyx", note: "schema.org ProductGroup · 65 variants" },
  { label: "Nike · Air Force 1 '07", url: "https://www.nike.com/t/air-force-1-07-mens-shoes-jBrhbr/CW2288-111", note: "schema.org ProductGroup · 22 sizes" },
  { label: "Samsung · Galaxy S25 Ultra", url: "https://www.samsung.com/us/smartphones/galaxy-s25-ultra/buy/", note: "schema.org Product" },
  { label: "LEGO · Millennium Falcon", url: "https://www.lego.com/en-us/product/millennium-falcon-75375", note: "Cloudflare challenge → rendered in a headless browser (~6 s)" },
];
