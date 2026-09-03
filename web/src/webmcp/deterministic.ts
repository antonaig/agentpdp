import type { Product } from "@shared/types";
import { formatMoney } from "@/lib/format";

/**
 * Fallback for ask_about_product when the server has no LLM (501).
 * Keyword overlap between the question and the product's own data: specs, options, price, availability, description sentences.
 * Nothing is generated. When nothing overlaps, the honest answer is "The product page doesn't say."
 */
export interface DeterministicAnswer { answer: string; mode: "deterministic"; grounded: true; sources: string[] }

export const NO_ANSWER = "The product page doesn't say.";

const STOP = new Set(["the","and","for","are","but","not","you","all","any","can","had","her","was","one","our","out","has","have","this","that","with","they","from","what","which","does","doe","did","will","would","could","should","about","there","their","these","those","than","then","them","into","onto","your","its","how","who","why","when","where","much","many","come","comes","get","got","like","also","just","only","some","such","more","most","very","tell","know","need","want","product","item","thing","page"]);

// Light synonym groups; both question and candidate tokens are mapped to the group id.
const GROUPS: Record<string, string[]> = {
  price: ["price","cost","costs","pricing","expensive","cheap","cheaper","dollar","dollars","pay","paying","discount","sale"],
  size: ["size","sizes","sized","dimension","dimensions","measurement","measurements","measure","big","large","small","wide","width","length","long","tall","height","inch","inches","cm","fit","fits","fitting"],
  color: ["color","colors","colour","colours","shade","shades","tone","tones"],
  stock: ["stock","available","availability","instock","sold","backorder","inventory"],
  material: ["material","materials","made","fabric","fabrics","cotton","linen","wool","leather","polyester","composition","gsm","thread"],
  care: ["care","wash","washing","washable","clean","cleaning","dry","dryer","bleach","iron","ironing","machine","laundry"],
  include: ["include","includes","included","inside","box","set","pieces","piece","comes","ships","ship","shipped"],
  origin: ["origin","made","country","where","manufactured","woven","sewn"],
  weight: ["weight","weigh","weighs","heavy","light","lightweight"],
  warranty: ["warranty","guarantee","guaranteed","return","returns","refund"],
};
const TOKEN_TO_GROUP = new Map<string, string>();
for (const [g, words] of Object.entries(GROUPS)) for (const w of words) TOKEN_TO_GROUP.set(w, g);

const stem = (t: string) => (t.length > 4 && t.endsWith("es") ? t.slice(0, -2) : t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().replace(/[^a-z0-9%"]+/g, " ").split(" ")) {
    if (raw.length < 3 && !/^\d+$/.test(raw)) continue;
    if (STOP.has(raw)) continue;
    const g = TOKEN_TO_GROUP.get(raw);
    if (g) out.add(`#${g}`);
    const s = stem(raw);
    if (!STOP.has(s)) out.add(s);
  }
  return out;
}

interface Candidate { text: string; source: string; toks: Set<string>; weight: number }

function candidates(p: Product): Candidate[] {
  const c: Candidate[] = [];
  for (const [k, v] of Object.entries(p.specs ?? {})) {
    c.push({ text: `${k}: ${v}`, source: `specs.${k}`, toks: tokens(`${k} ${k} ${v}`), weight: 1.5 });
  }
  for (const o of p.options ?? []) {
    c.push({ text: `${o.name} options: ${o.values.join(", ")}.`, source: `options.${o.name}`, toks: tokens(`${o.name} ${o.name} ${o.values.join(" ")}`), weight: 1.5 });
  }
  const range = p.priceRange && p.priceRange.min.amount !== p.priceRange.max.amount ? ` (${formatMoney(p.priceRange.min)} to ${formatMoney(p.priceRange.max)} across variants)` : "";
  const compareAt = p.compareAtPrice ? `, compare-at ${formatMoney(p.compareAtPrice)}` : "";
  c.push({ text: `Price: ${formatMoney(p.price)}${range}${compareAt}.`, source: "price", toks: new Set(["#price", "price"]), weight: 2 });
  const inStock = p.variants.filter(v => v.available === true).length;
  const known = p.variants.filter(v => v.available !== null).length;
  const availText = p.availability === "unknown" || known === 0
    ? "Availability: the page had no live inventory signal at extract time."
    : `Availability at extract time: ${p.availability.replace("_", " ")}; ${inStock} of ${p.variants.length} variants in stock.`;
  c.push({ text: availText, source: "availability", toks: new Set(["#stock", "stock", "available", "availability"]), weight: 2 });
  for (const sentence of (p.description ?? "").split(/(?<=[.!?])\s+|\n+/)) {
    const s = sentence.trim();
    if (s.length < 20) continue;
    c.push({ text: s, source: "description", toks: tokens(s), weight: 1 });
  }
  return c;
}

export function deterministicAnswer(p: Product, question: string): DeterministicAnswer {
  const q = tokens(question);
  // Words that merely name the product ("duvet cover") are not evidence of an answer.
  for (const t of tokens(`${p.brand ?? ""} ${p.title}`)) q.delete(t);
  if (q.size === 0) return { answer: NO_ANSWER, mode: "deterministic", grounded: true, sources: [] };

  const scored = candidates(p)
    .map(c => { let hits = 0; for (const t of q) if (c.toks.has(t)) hits += t.startsWith("#") ? 1.5 : 1; return { c, score: hits * c.weight }; })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { answer: NO_ANSWER, mode: "deterministic", grounded: true, sources: [] };

  const top = scored[0].score;
  const picked = scored.filter(x => x.score >= top * 0.5).slice(0, 3);
  const answer = picked.map(x => x.c.text).join(" ");
  const sources = [...new Set(picked.map(x => x.c.source))];
  return { answer, mode: "deterministic", grounded: true, sources };
}
