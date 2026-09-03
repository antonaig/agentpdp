import { toolDefs } from "@shared/tools";
import type { ToolPolicy } from "@shared/types";
import { useStore } from "@/state/store";
import { toolKind } from "./helpers";
import "./merchant.css";

const DEFS = toolDefs("", "");
const POLICIES: { value: ToolPolicy; label: string }[] = [
  { value: "on", label: "On" },
  { value: "confirm", label: "Confirm" },
  { value: "off", label: "Off" },
];
const RATE_OPTIONS = [0, 10, 30, 60, 120];

/** Per-tool policy (On / Confirm / Off) plus the two global rules. Writes straight to the shared store; the webmcp layer reacts. */
export function PolicyTable() {
  const policy = useStore((s) => s.policy);
  const setToolPolicy = useStore((s) => s.setToolPolicy);
  const setHideCompareAtPrice = useStore((s) => s.setHideCompareAtPrice);
  const setRateLimit = useStore((s) => s.setRateLimit);
  const resetPolicy = useStore((s) => s.resetPolicy);

  const rateOptions = RATE_OPTIONS.includes(policy.rateLimitPerMinute) ? RATE_OPTIONS : [...RATE_OPTIONS, policy.rateLimitPerMinute].sort((a, b) => a - b);

  return (
    <section className="mp-section" aria-labelledby="mp-policy-h">
      <div className="mp-section-head">
        <h3 id="mp-policy-h">Tools</h3>
        <button type="button" className="mp-link" onClick={resetPolicy}>Reset to defaults</button>
      </div>
      <table className="mp-table mp-policy">
        <tbody>
          {DEFS.map((def) => {
            const cur = policy.tools[def.name];
            const kind = toolKind(def);
            return (
              <tr key={def.name} className={cur === "off" ? "is-off" : undefined} data-tool={def.name}>
                <td>
                  <div className="mp-tool">
                    <span className="mono">{def.name}</span>
                    <span className={`mp-kind ${kind === "read" ? "read" : "write"}`}>{kind}</span>
                    {cur === "off" && <span className="mp-note">hidden from agents</span>}
                    {cur === "confirm" && <span className="mp-note">human taps to approve</span>}
                  </div>
                </td>
                <td className="mp-ctl">
                  <div className="mp-seg" role="group" aria-label={`${def.name} policy`}>
                    {POLICIES.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        data-policy={p.value}
                        data-testid={`policy-${def.name}-${p.value}`}
                        aria-pressed={cur === p.value}
                        className={cur === p.value ? "is-active" : undefined}
                        onClick={() => setToolPolicy(def.name, p.value)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mp-rules">
        <label className="mp-rule">
          <span>Hide compare-at prices from agents</span>
          <input
            type="checkbox"
            role="switch"
            className="mp-switch"
            checked={policy.hideCompareAtPrice}
            onChange={(e) => setHideCompareAtPrice(e.target.checked)}
          />
        </label>
        <label className="mp-rule">
          <span>Rate limit</span>
          <select value={policy.rateLimitPerMinute} onChange={(e) => setRateLimit(Number(e.target.value))} aria-label="Rate limit">
            {rateOptions.map((n) => (
              <option key={n} value={n}>{n === 0 ? "0 (none)" : `${n} per minute`}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
