import { Link } from "react-router-dom";
import { explainExtractError } from "@/lib/format";

export function ProductSkeleton() {
  return (
    <div className="pdp-grid" aria-busy="true" aria-label="Loading product" data-testid="product-skeleton">
      <div className="gallery"><div className="skel" style={{ aspectRatio: "1 / 1" }} /><div className="gallery-thumbs">{[0, 1, 2].map(i => <div key={i} className="skel" style={{ width: 64, height: 64 }} />)}</div></div>
      <div>
        <div className="skel" style={{ height: 14, width: 90, marginBottom: 10 }} />
        <div className="skel" style={{ height: 30, width: "80%", marginBottom: 14 }} />
        <div className="skel" style={{ height: 24, width: 120, marginBottom: 22 }} />
        <div className="skel" style={{ height: 38, width: "70%", marginBottom: 10 }} />
        <div className="skel" style={{ height: 38, width: "50%", marginBottom: 22 }} />
        <div className="skel" style={{ height: 44, width: 180, marginBottom: 26 }} />
        <div className="skel" style={{ height: 80, width: "100%" }} />
      </div>
      <div className="skel" style={{ height: 320 }} />
    </div>
  );
}

export function ErrorState({ code, message, url, onRetry }: { code?: string; message?: string; url?: string; onRetry?: () => void }) {
  return (
    <div className="card error-state" role="alert" data-testid="product-error">
      <h2>Could not build this page</h2>
      <p style={{ margin: 0 }}>{explainExtractError(code, message)}</p>
      {url && <p className="muted" style={{ margin: "8px 0 0", wordBreak: "break-all" }}>{url}</p>}
      {code && <div className="code" style={{ marginTop: 8 }}>{code}{message && code !== message ? ` · ${message}` : ""}</div>}
      <div className="row">
        {onRetry && <button type="button" className="btn primary" onClick={onRetry}>Retry</button>}
        <Link to="/" className="btn">Try another URL</Link>
      </div>
    </div>
  );
}
