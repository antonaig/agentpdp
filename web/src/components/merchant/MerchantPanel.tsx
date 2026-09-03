import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { PolicyTable } from "./PolicyTable";
import { LedgerTable } from "./LedgerTable";
import { Counters } from "./Counters";
import "./merchant.css";

export const COLLAPSED_KEY = "agentpdp.merchant.collapsed";

function readCollapsed(): boolean {
  try { return window.localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}

/**
 * Right rail on the generated product page. Shows what agents may do (policies) and what they did (ledger).
 * Everything here reads live from the shared zustand store; the product page stays the hero.
 */
export function MerchantPanel() {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  useEffect(() => {
    try { window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* storage unavailable: forget between loads */ }
  }, [collapsed]);

  const agentApi = useStore((s) => s.agentApi);
  const registered = useStore((s) => s.registeredTools);
  const status = agentApi === "none"
    ? "No agent connected"
    : `Agent API: ${agentApi} · ${registered.length} ${registered.length === 1 ? "tool" : "tools"} registered`;

  return (
    <aside className={`mp${collapsed ? " is-collapsed" : ""}`} aria-label="Merchant view" data-collapsed={collapsed ? "true" : "false"}>
      <header className="mp-head">
        <div>
          <h2>Merchant view</h2>
          {!collapsed && <p className="mp-lede">What agents can do on this page, and what they did. Stored in this browser for the demo.</p>}
        </div>
        <button type="button" className="mp-toggle" data-testid="merchant-panel-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "Show" : "Hide"}
        </button>
      </header>
      {!collapsed && (
        <>
          <p className="mp-status mono" data-agent={agentApi}>{status}</p>
          <PolicyTable />
          <Counters />
          <LedgerTable />
        </>
      )}
    </aside>
  );
}
