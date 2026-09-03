import { useEffect, useState } from "react";
import { useStore } from "@/state/store";

const TIMEOUT_S = 60;

/** Renders store.pendingConfirm. Approve / Decline; auto-declines after 60 s so an agent call never hangs on a walked-away human. */
export function ConfirmDialog() {
  const pending = useStore(s => s.pendingConfirm);
  const resolve = useStore(s => s.resolveConfirm);
  const [left, setLeft] = useState(TIMEOUT_S);

  useEffect(() => {
    if (!pending) return;
    setLeft(TIMEOUT_S);
    const started = Date.now();
    const tick = setInterval(() => setLeft(Math.max(0, TIMEOUT_S - Math.floor((Date.now() - started) / 1000))), 500);
    const timeout = setTimeout(() => { if (useStore.getState().pendingConfirm?.id === pending.id) resolve(false); }, TIMEOUT_S * 1000);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") resolve(false); };
    document.addEventListener("keydown", onKey);
    return () => { clearInterval(tick); clearTimeout(timeout); document.removeEventListener("keydown", onKey); };
  }, [pending?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pending) return null;
  return (
    <div className="confirm-backdrop" role="presentation">
      <div className="card confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" data-testid="confirm-dialog">
        <h2 id="confirm-title"><span className="pill agent">Agent request</span></h2>
        <div className="summary">{pending.summary}</div>
        <div className="meta">
          An agent asked to run <span className="mono">{pending.tool}</span>. Nothing happens until you approve. Auto-declines in {left} s.
        </div>
        <div className="row">
          <button type="button" className="btn" data-testid="confirm-decline" onClick={() => resolve(false)}>Decline</button>
          <button type="button" className="btn primary" data-testid="confirm-approve" onClick={() => resolve(true)} autoFocus>Approve</button>
        </div>
      </div>
    </div>
  );
}
