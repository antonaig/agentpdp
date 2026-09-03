import type { Money, Product } from "@shared/types";

/** Output of compare_with: two products plus a structured diff. Kept small so it survives JSON-stringify into an agent prompt. */
export interface CompareDifferences {
  price: {
    a: Money; b: Money;
    delta: number | null;                      // b.amount - a.amount when currencies match, else null
    cheaper: "a" | "b" | "same" | "unknown";
  };
  options: {
    only_a: string[];                          // option names only product A has
    only_b: string[];
    shared: { name: string; a_values: string[]; b_values: string[]; only_a: string[]; only_b: string[] }[];
  };
  availability: { a: Product["availability"]; b: Product["availability"]; a_in_stock_variants: number; b_in_stock_variants: number };
  specs: {
    shared: { key: string; a: string; b: string; same: boolean }[];
    only_a: Record<string, string>;
    only_b: Record<string, string>;
  };
}

export interface CompareState {
  a: Product;
  b: Product;
  differences: CompareDifferences;
  ts: string; // ISO
}

const norm = (s: string) => s.trim().toLowerCase();

export function diffProducts(a: Product, b: Product): CompareDifferences {
  const sameCurrency = a.price.currency === b.price.currency;
  const delta = sameCurrency ? Math.round((b.price.amount - a.price.amount) * 100) / 100 : null;
  const cheaper: CompareDifferences["price"]["cheaper"] = !sameCurrency ? "unknown" : delta === 0 ? "same" : delta! > 0 ? "a" : "b";

  const aOpts = new Map(a.options.map(o => [norm(o.name), o]));
  const bOpts = new Map(b.options.map(o => [norm(o.name), o]));
  const shared: CompareDifferences["options"]["shared"] = [];
  for (const [k, oa] of aOpts) {
    const ob = bOpts.get(k);
    if (!ob) continue;
    const bv = new Set(ob.values.map(norm));
    const av = new Set(oa.values.map(norm));
    shared.push({
      name: oa.name,
      a_values: oa.values,
      b_values: ob.values,
      only_a: oa.values.filter(v => !bv.has(norm(v))),
      only_b: ob.values.filter(v => !av.has(norm(v))),
    });
  }
  const options = {
    only_a: a.options.filter(o => !bOpts.has(norm(o.name))).map(o => o.name),
    only_b: b.options.filter(o => !aOpts.has(norm(o.name))).map(o => o.name),
    shared,
  };

  const aSpecs = new Map(Object.entries(a.specs ?? {}).map(([k, v]) => [norm(k), { k, v }]));
  const bSpecs = new Map(Object.entries(b.specs ?? {}).map(([k, v]) => [norm(k), { k, v }]));
  const specsShared: CompareDifferences["specs"]["shared"] = [];
  const onlyA: Record<string, string> = {};
  const onlyB: Record<string, string> = {};
  for (const [k, { k: key, v }] of aSpecs) {
    const other = bSpecs.get(k);
    if (other) specsShared.push({ key, a: v, b: other.v, same: norm(v) === norm(other.v) });
    else onlyA[key] = v;
  }
  for (const [k, { k: key, v }] of bSpecs) if (!aSpecs.has(k)) onlyB[key] = v;

  return {
    price: { a: a.price, b: b.price, delta, cheaper },
    options,
    availability: {
      a: a.availability, b: b.availability,
      a_in_stock_variants: a.variants.filter(v => v.available === true).length,
      b_in_stock_variants: b.variants.filter(v => v.available === true).length,
    },
    specs: { shared: specsShared, only_a: onlyA, only_b: onlyB },
  };
}
