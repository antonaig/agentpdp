import { useEffect } from "react";
import { useStore } from "@/state/store";

const SHOW_MS = 3200;

/** Toast in --agent color whenever a TOOL (not the human) changed the page. */
export function AgentToast() {
  const trace = useStore(s => s.agentTrace);
  const clear = useStore(s => s.clearAgentTrace);
  useEffect(() => {
    if (!trace) return;
    const t = setTimeout(() => clear(trace.id), SHOW_MS);
    return () => clearTimeout(t);
  }, [trace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!trace) return null;
  return (
    <div className="agent-toast" role="status" aria-live="polite" data-testid="agent-toast" key={trace.id}>
      <span className="agent-dot" aria-hidden="true" />
      {trace.message}
    </div>
  );
}
