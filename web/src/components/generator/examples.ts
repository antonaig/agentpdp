export interface ExampleUrl {
  label: string;   // short chip text
  url: string;     // the real product page
  note: string;    // what makes it a good demo
}

/**
 * Real product pages, verified 2026-09-04 ~01:50 IDT: page HTML 200 and `<url>.json` 200 with a product record.
 * Brooklinen and Allbirds are Shopify stores, so the fast path (`/products/<handle>.json`) applies.
 * The orchestrator may swap this list for the wider verified matrix. Keep it the one place example URLs live.
 */
export const EXAMPLE_URLS: ExampleUrl[] = [
  { label: "Brooklinen · Luxe Sateen sheet set", url: "https://www.brooklinen.com/products/luxe-core-sheet-set", note: "Color × Size, 174 variants" },
  { label: "Brooklinen · Super-Plush towel set", url: "https://www.brooklinen.com/products/super-plush-4-piece-bath-towel-set", note: "7 colors" },
  { label: "Brooklinen · Classic Percale sheet set", url: "https://www.brooklinen.com/products/classic-core-sheet-set", note: "Color × Size, 162 variants" },
  { label: "Allbirds · Women's Dasher NZ", url: "https://www.allbirds.com/products/womens-dasher-nz-blizzard-deep-navy", note: "13 sizes" },
  { label: "Allbirds · Men's Cruiser", url: "https://www.allbirds.com/products/mens-cruiser-shadow-blue-natural-white-sole", note: "13 sizes" },
];
