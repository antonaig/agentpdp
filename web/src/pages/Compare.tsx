import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ExtractSource, Money, Product } from "@shared/types";
import { fetchExtract, urlToPagePath } from "@/lib/api";
import { describeFetchError } from "@/components/generator/errors";
import "@/components/generator/compare.css";

type SideState =
  | { kind: "loading" }
  | { kind: "ok"; product: Product; source: ExtractSource }
  | { kind: "error"; message: string };

interface Side { url: string; state: SideState }

function fmtMoney(m?: Money): string {
  if (!m) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: m.currency }).format(m.amount);
  } catch {
    return `${m.amount} ${m.currency}`;
  }
}

function safePagePath(url: string): string | null {
  try { return urlToPagePath(url); } catch { return null; }
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

const AVAILABILITY: Record<Product["availability"], string> = { in_stock: "In stock", out_of_stock: "Out of stock", unknown: "Unknown — no live inventory signal" };

/** `/compare?a=<url>&b=<url>` — fetches both in parallel and lays them out row by row. No tools registered here. */
export function ComparePage() {
  const [params] = useSearchParams();
  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";
  const [sides, setSides] = useState<Side[] | null>(null);

  useEffect(() => {
    if (!a || !b) { setSides(null); return; }
    let cancelled = false;
    const urls = [a, b];
    setSides(urls.map((url) => ({ url, state: { kind: "loading" } })));
    urls.forEach((url, i) => {
      fetchExtract(url)
        .then((r) => {
          if (cancelled) return;
          const state: SideState = r.ok ? { kind: "ok", product: r.product, source: r.source } : { kind: "error", message: `${r.code}: ${r.error}` };
          setSides((prev) => (prev ? prev.map((s, j) => (j === i ? { url, state } : s)) : prev));
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          const message = `fetch_failed: ${describeFetchError(e)}`;
          setSides((prev) => (prev ? prev.map((s, j) => (j === i ? { url, state: { kind: "error", message } } : s)) : prev));
        });
    });
    return () => { cancelled = true; };
  }, [a, b]);

  const specKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const s of sides ?? []) if (s.state.kind === "ok") for (const k of Object.keys(s.state.product.specs)) keys.add(k);
    return [...keys].sort((x, y) => x.localeCompare(y));
  }, [sides]);

  if (!a || !b) {
    return (
      <main className="container">
        <div className="cmp-head"><h1>Compare</h1><Link to="/">Generator</Link></div>
        <p className="cmp-empty muted">Two product URLs are needed: <code>/compare?a=&lt;url&gt;&amp;b=&lt;url&gt;</code>. Agents get here through the <code>compare_with</code> tool on a generated page.</p>
      </main>
    );
  }

  const cell = (s: Side, render: (p: Product, source: ExtractSource) => ReactNode): ReactNode => {
    if (s.state.kind === "loading") return <span className="muted">Loading…</span>;
    if (s.state.kind === "error") return <span className="muted">—</span>;
    return render(s.state.product, s.state.source);
  };

  const rows: { label: string; render: (p: Product, source: ExtractSource) => ReactNode }[] = [
    { label: "Image", render: (p) => (p.images[0] ? <img className="cmp-img" src={p.images[0]} alt={p.title} loading="lazy" /> : <span className="muted">—</span>) },
    { label: "Brand", render: (p) => p.brand ?? <span className="muted">—</span> },
    { label: "Title", render: (p) => <strong>{p.title}</strong> },
    { label: "Price", render: (p) => (p.priceRange && p.priceRange.min.amount !== p.priceRange.max.amount ? `${fmtMoney(p.priceRange.min)} – ${fmtMoney(p.priceRange.max)}` : fmtMoney(p.price)) },
    { label: "Compare-at", render: (p) => fmtMoney(p.compareAtPrice) },
    {
      label: "Options",
      render: (p) => (p.options.length === 0 ? <span className="muted">Single variant</span> : (
        <ul className="cmp-list">{p.options.map((o) => <li key={o.name}><b>{o.name}:</b> {o.values.join(", ")}</li>)}</ul>
      )),
    },
    { label: "Availability", render: (p) => AVAILABILITY[p.availability] },
    { label: "Source", render: (_p, source) => <span className="mono">{source}</span> },
    ...specKeys.map((k) => ({ label: k, render: (p: Product) => p.specs[k] ?? <span className="muted">—</span> })),
  ];

  return (
    <main className="container">
      <div className="cmp-head"><h1>Compare</h1><Link to="/">Generator</Link></div>
      <div className="card cmp-wrap">
        <table className="cmp-table">
          <thead>
            <tr>
              <th scope="col" aria-label="Field" />
              {(sides ?? []).map((s, i) => (
                <th scope="col" key={i}>
                  <span className="cmp-host">{hostOf(s.url)}</span>
                  {s.state.kind === "error" ? <span className="cmp-err" role="alert">{s.state.message}</span> : (safePagePath(s.url) ? <Link to={safePagePath(s.url)!}>Open agent-ready page</Link> : <span className="muted">Invalid URL</span>)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {(sides ?? []).map((s, i) => <td key={i}>{cell(s, row.render)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
