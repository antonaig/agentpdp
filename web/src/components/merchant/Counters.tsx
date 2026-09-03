import { useStore } from "@/state/store";
import { computeCounters } from "./helpers";
import "./merchant.css";

export function Counters() {
  const ledger = useStore((s) => s.ledger);
  const humanActions = useStore((s) => s.session.humanActions);
  const c = computeCounters(ledger, { humanActions });
  const items: { label: string; value: number; id: string }[] = [
    { label: "calls", value: c.calls, id: "calls" },
    { label: "carts created", value: c.carts, id: "carts" },
    { label: "blocked", value: c.blocked, id: "blocked" },
    { label: "human actions", value: c.human, id: "human" },
  ];
  return (
    <div className="mp-counters" role="list" aria-label="Counters">
      {items.map((it) => (
        <div key={it.label} className="mp-counter" role="listitem" data-counter={it.id} data-testid={`counter-${it.id}`}>
          <b>{it.value}</b>
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
