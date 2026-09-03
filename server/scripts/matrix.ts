/**
 * Live extraction matrix: runs the real ladder against real PDP URLs and prints a table.
 *
 *   npx tsx server/scripts/matrix.ts               # default URL set
 *   npx tsx server/scripts/matrix.ts <url> [<url>] # your own URLs
 *   HEADLESS_FALLBACK=0 npx tsx server/scripts/matrix.ts   # skip the browser rung
 *
 * Nothing here is mocked. Failures print the failing rung and HTTP status.
 */
import { extractProduct } from "../extract/index.js";
import { closeBrowser } from "../extract/headless.js";

const DEFAULT_URLS = [
  // Shopify (storefront feed)
  "https://www.brooklinen.com/products/luxe-core-sheet-set",
  "https://www.allbirds.com/products/mens-strider-explore",
  // Shopify Plus headless storefront (Next.js RSC; feed 404s; geo-redirects to /en-xx/)
  "https://skims.com/products/fits-everybody-t-shirt-bra-onyx",
  // Salesforce Commerce Cloud behind Akamai Bot Manager
  "https://shop.lululemon.com/p/womens-leggings/Align-Pant-2/_/prod2020012",
  // Nike (custom platform, JSON-LD ProductGroup)
  "https://www.nike.com/t/air-force-1-07-mens-shoes-jBrhbr/CW2288-111",
  // Diverse others: Zappos (custom), Bose (Salesforce Commerce Cloud, no bot wall), Samsung (custom), WooCommerce, Cloudflare-walled
  "https://www.zappos.com/p/hoka-clifton-11-black-neon-nebula/product/10047368/color/1130747",
  "https://www.bose.com/p/headphones/bose-quietcomfort-ultra-headphones-2nd-gen/QCUH2-HEADPHONEARN.html",
  "https://www.samsung.com/us/smartphones/galaxy-s25-ultra/buy/",
  "https://offermanwoodshop.com/store/kindlin/hearth-home/kitchen-trivets",
  "https://www.lego.com/en-us/product/millennium-falcon-75375",
  "https://www.gildan.com/en-us/products/mens-heavy-cotton-t-shirt-5000",
];

interface Row {
  url: string;
  ok: string;
  source: string;
  ms: string;
  title: string;
  variants: string;
  availability: string;
  notes: string;
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function printTable(rows: Row[]) {
  const cols: (keyof Row)[] = ["url", "ok", "source", "ms", "title", "variants", "availability", "notes"];
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => r[c].length)));
  const line = (r: Record<keyof Row, string>) => "| " + cols.map((c, i) => r[c].padEnd(widths[i])).join(" | ") + " |";
  const header = cols.reduce((acc, c) => ({ ...acc, [c]: c }), {} as Record<keyof Row, string>);
  console.log(line(header));
  console.log("|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|");
  rows.forEach((r) => console.log(line(r)));
}

async function main() {
  const urls = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_URLS;
  const rows: Row[] = [];
  for (const url of urls) {
    const t0 = Date.now();
    process.stderr.write(`→ ${url}\n`);
    const r = await extractProduct(url, { fresh: true });
    const ms = Date.now() - t0;
    const rungs = r.rungs.map((g) => `${g.name}${g.ok ? "✓" : "✗"}(${g.ms}ms${g.note ? ` ${trunc(g.note, 60)}` : ""})`).join(" → ");
    process.stderr.write(`   ${rungs}\n`);
    if (r.ok) {
      rows.push({
        url: trunc(url.replace(/^https:\/\//, ""), 58),
        ok: "yes",
        source: r.source + (r.warnings.some((w) => w.includes("headless")) ? "+headless" : ""),
        ms: String(ms),
        title: trunc(r.product.title, 34),
        variants: String(r.product.variants.length),
        availability: r.product.availability,
        notes: trunc(r.warnings.join("; "), 70),
      });
    } else {
      const lastFail = [...r.rungs].reverse().find((g) => !g.ok);
      rows.push({
        url: trunc(url.replace(/^https:\/\//, ""), 58),
        ok: "no",
        source: lastFail ? `fail@${lastFail.name}` : "-",
        ms: String(ms),
        title: "-",
        variants: "-",
        availability: "-",
        notes: trunc(`${r.code}: ${r.error}${lastFail ? ` [${lastFail.note}]` : ""}`, 70),
      });
    }
  }
  console.log("");
  printTable(rows);
  await closeBrowser();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
