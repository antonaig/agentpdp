import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { exportLedgerJson, formatArgs, hhmmss, outcomeTone, truncate } from "./helpers";
import "./merchant.css";

/** Every agent call on this page, newest first. Args are truncated; click a row's args to expand. */
export function LedgerTable() {
  const ledger = useStore((s) => s.ledger);
  const clearLedger = useStore((s) => s.clearLedger);
  const host = useStore((s) => s.product?.host);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const rows = useMemo(() => [...ledger].sort((a, b) => b.ts.localeCompare(a.ts)), [ledger]);
  const pageHost = host ?? (typeof location !== "undefined" ? location.host : "page");

  return (
    <section className="mp-section" aria-labelledby="mp-ledger-h">
      <div className="mp-section-head">
        <h3 id="mp-ledger-h">Ledger</h3>
        <div className="mp-actions">
          <button type="button" className="mp-link" disabled={rows.length === 0} onClick={() => exportLedgerJson(rows, pageHost)}>Export JSON</button>
          <button type="button" className="mp-link" disabled={rows.length === 0} onClick={clearLedger}>Clear</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="mp-empty">No agent calls yet.</p>
      ) : (
        <div className="mp-ledger-wrap">
          <table className="mp-table mp-ledger">
            <thead>
              <tr>
                <th scope="col">time</th>
                <th scope="col">tool</th>
                <th scope="col">args</th>
                <th scope="col">outcome</th>
                <th scope="col" className="mp-num">ms</th>
                <th scope="col">agent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const full = formatArgs(e.args);
                const expanded = !!open[e.id];
                return (
                  <tr key={e.id} data-outcome={e.outcome} data-testid="ledger-row">
                    <td className="mono">{hhmmss(e.ts)}</td>
                    <td className="mono">{e.tool}</td>
                    <td
                      className="mono mp-args"
                      title={expanded ? "Click to collapse" : full.length > 60 ? "Click to expand" : undefined}
                      onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
                    >
                      {expanded ? <pre>{formatArgs(e.args, true)}</pre> : truncate(full, 60)}
                    </td>
                    <td>
                      <span className={`pill mp-pill ${outcomeTone(e.outcome)}`} title={e.resultSummary}>{e.outcome}</span>
                    </td>
                    <td className="mono mp-num">{Math.round(e.ms)}</td>
                    <td className="mono mp-agent" title={e.agent}>{e.agent}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
