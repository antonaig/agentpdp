import { useEffect } from "react";
import { useStore } from "@/state/store";
import { formatMoney, hostLabel } from "@/lib/format";

const avail = (a: string) => a.replace("_", " ");

/** Compact side-by-side opened by compare_with. The full page lives at /compare?a=&b=. */
export function CompareDrawer() {
  const cmp = useStore(s => s.compare);
  const setCompare = useStore(s => s.setCompare);
  useEffect(() => {
    if (!cmp) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCompare(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cmp, setCompare]);
  if (!cmp) return null;
  const { a, b, differences: d } = cmp;
  const fullUrl = `/compare?a=${encodeURIComponent(a.url)}&b=${encodeURIComponent(b.url)}`;
  const Head = ({ p }: { p: typeof a }) => (
    <th><span className="title">{p.brand ? `${p.brand} ` : ""}{p.title}</span><span className="host">{hostLabel(p.host)}</span></th>
  );
  return (
    <>
      <div className="drawer-backdrop" onClick={() => setCompare(null)} />
      <aside className="drawer" role="dialog" aria-label="Comparison" data-testid="compare-drawer">
        <div className="drawer-head">
          <h2>Compared by an agent</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <a className="btn" href={fullUrl} target="_blank" rel="noopener">Full view</a>
            <button type="button" className="btn" onClick={() => setCompare(null)}>Close</button>
          </div>
        </div>
        <table className="cmp">
          <thead><tr><th className="key"></th><Head p={a} /><Head p={b} /></tr></thead>
          <tbody>
            <tr>
              <th className="key">Price</th>
              <td className={d.price.cheaper === "a" ? "diff" : ""}>{formatMoney(a.price)}{a.priceRange && a.priceRange.min.amount !== a.priceRange.max.amount ? <div className="muted">{formatMoney(a.priceRange.min)} – {formatMoney(a.priceRange.max)}</div> : null}</td>
              <td className={d.price.cheaper === "b" ? "diff" : ""}>{formatMoney(b.price)}{b.priceRange && b.priceRange.min.amount !== b.priceRange.max.amount ? <div className="muted">{formatMoney(b.priceRange.min)} – {formatMoney(b.priceRange.max)}</div> : null}</td>
            </tr>
            <tr>
              <th className="key">Availability</th>
              <td>{avail(d.availability.a)} · {d.availability.a_in_stock_variants}/{a.variants.length} variants</td>
              <td>{avail(d.availability.b)} · {d.availability.b_in_stock_variants}/{b.variants.length} variants</td>
            </tr>
            {d.options.shared.map(o => (
              <tr key={o.name}>
                <th className="key">{o.name}</th>
                <td className={o.only_a.length ? "diff" : ""}>{o.a_values.join(", ")}</td>
                <td className={o.only_b.length ? "diff" : ""}>{o.b_values.join(", ")}</td>
              </tr>
            ))}
            {d.options.only_a.map(n => <tr key={`a-${n}`}><th className="key">{n}</th><td className="diff">{a.options.find(o => o.name === n)?.values.join(", ")}</td><td className="muted">—</td></tr>)}
            {d.options.only_b.map(n => <tr key={`b-${n}`}><th className="key">{n}</th><td className="muted">—</td><td className="diff">{b.options.find(o => o.name === n)?.values.join(", ")}</td></tr>)}
            {d.specs.shared.map(s => (
              <tr key={s.key}><th className="key">{s.key}</th><td className={s.same ? "" : "diff"}>{s.a}</td><td className={s.same ? "" : "diff"}>{s.b}</td></tr>
            ))}
            {Object.entries(d.specs.only_a).map(([k, v]) => <tr key={`sa-${k}`}><th className="key">{k}</th><td>{v}</td><td className="muted">not listed</td></tr>)}
            {Object.entries(d.specs.only_b).map(([k, v]) => <tr key={`sb-${k}`}><th className="key">{k}</th><td className="muted">not listed</td><td>{v}</td></tr>)}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
          Both records come from each store's own page data at extract time. "Not listed" means the page did not say.
        </p>
      </aside>
    </>
  );
}
