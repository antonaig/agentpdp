import { useEffect, useRef, useState } from "react";
import { TOOL_NAMES } from "@shared/types";
import { toolDefs } from "@shared/tools";
import { useStore } from "@/state/store";

const POLICY_LABEL = { on: "on", confirm: "human confirms", off: "off — hidden from agents" } as const;

/** "Agent API: document.modelContext · 8 site tools" — expands to the tool list with each tool's current policy. */
export function SiteToolsBadge() {
  const agentApi = useStore(s => s.agentApi);
  const registered = useStore(s => s.registeredTools);
  const policies = useStore(s => s.policy.tools);
  const product = useStore(s => s.product);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const defs = toolDefs(product?.brand ?? "", product?.title ?? "this product");
  const hasAgent = agentApi !== "none";
  return (
    <div className="tools-badge" ref={ref}>
      <button
        type="button"
        className={`pill${hasAgent ? " agent" : ""}`}
        data-testid="site-tools-badge"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        title={hasAgent ? `Agent API detected: ${agentApi}` : "No agent API in this browser"}
      >
        <span aria-hidden="true">{hasAgent ? "●" : "○"}</span>
        {hasAgent ? `${registered.length} site tools` : `${TOOL_NAMES.length} site tools`}
        <span className="muted" style={{ fontWeight: 500 }}>{hasAgent ? "· agent API detected" : "· no agent"}</span>
      </button>
      {open && (
        <div className="card tools-pop" role="dialog" aria-label="Site tools">
          <h4>Site tools on this page</h4>
          <table>
            <tbody>
              {defs.map(def => {
                const pol = policies[def.name];
                const isRegistered = registered.includes(def.name);
                return (
                  <tr key={def.name} data-testid={`site-tool-${def.name}`}>
                    <td>
                      <span className="mono">{def.name}</span>
                      <span className="desc">{def.annotations.consequentialHint ? "consequential · " : def.annotations.readOnlyHint ? "read-only · " : ""}{def.description.split(".")[0]}.</span>
                    </td>
                    <td>
                      <span className={`pill ${pol === "off" ? "bad" : pol === "confirm" ? "warn" : "ok"}`}>{POLICY_LABEL[pol]}</span>
                      {hasAgent && pol !== "off" && !isRegistered && <span className="desc">not registered</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="foot">
            {hasAgent
              ? <>Registered on <span className="mono">{agentApi}</span>. Policies are set in the merchant panel and apply live.</>
              : <>No agent API in this browser, so nothing is registered. The tools register when an agent-capable browser opens this page.</>}
          </div>
        </div>
      )}
    </div>
  );
}
