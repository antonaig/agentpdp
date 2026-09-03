import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ExtractResult, ToolName } from "@shared/types";
import { pagePathToUrl, urlToPagePath } from "@/lib/api";
import { formatMoney, hostLabel, variantLabel } from "@/lib/format";
import { useStore } from "@/state/store";
import { registerPageTools, guardedHandler, isToolName } from "@/webmcp/register";
import { checkoutUrl } from "@/webmcp/handlers";
import { MerchantPanel } from "@/components/merchant/MerchantPanel";
import { Gallery } from "@/components/product/Gallery";
import { VariantPicker } from "@/components/product/VariantPicker";
import { SpecsTable } from "@/components/product/SpecsTable";
import { SiteToolsBadge } from "@/components/product/SiteToolsBadge";
import { ConfirmDialog } from "@/components/product/ConfirmDialog";
import { AgentNotice } from "@/components/product/AgentNotice";
import { AgentToast } from "@/components/product/AgentToast";
import { CompareDrawer } from "@/components/product/CompareDrawer";
import { ProductSkeleton, ErrorState } from "@/components/product/LoadState";
import "@/components/product/product.css";

/**
 * /p/<host>/<path> → the agent-ready product page.
 *  - fetches /api/extract for https://<host>/<path>, renders the product, registers the 8 WebMCP tools (register.ts)
 *  - the human path (click a variant, add to cart) uses the same store actions the tools use
 *  - agent actions leave visible traces (flash + toast in --agent color)
 *
 * E2E hook (any browser, no agent needed):
 *   window.__agentpdp.tools()            → names of the tools currently registered
 *   window.__agentpdp.call(name, args)   → runs the GUARDED handler (rate limit → policy → confirm → handler → ledger),
 *                                           exactly what document.modelContext would run. Returns the JSON result.
 */
declare global {
  interface Window {
    __agentpdp?: {
      tools: () => ToolName[];
      call: (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
  }
}

interface LoadError { code?: string; message?: string }

async function loadExtract(url: string): Promise<ExtractResult> {
  const res = await fetch(`/api/extract?url=${encodeURIComponent(url)}`);
  if (res.status === 501 && import.meta.env.DEV) {
    // Extractor not landed yet: DEV-only fixture so the page can be built and demoed. Never in production builds.
    const { mockExtractResult } = await import("@/lib/mock");
    return mockExtractResult(url);
  }
  try {
    return (await res.json()) as ExtractResult;
  } catch {
    return { ok: false, code: "fetch_failed", error: `The extract API answered ${res.status} without a readable body.` };
  }
}

const SOURCE_NOTE = {
  shopify: "Read from the store's Shopify product feed",
  jsonld: "Read from the page's schema.org product data",
  og: "Read from the rendered page's meta tags",
} as const;

export function ProductPage() {
  const location = useLocation();
  const navigate = useNavigate();

  // /p/<host>/<path>[?query] → https://<host>/<path>[?query] ; /p?url=<https://…> → redirect to the canonical path
  const target = useMemo(() => {
    const url = pagePathToUrl(location.pathname, location.search);
    if (url) return { url, redirect: null as string | null };
    const q = new URLSearchParams(location.search).get("url");
    return { url: null as string | null, redirect: q };
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!target.redirect) return;
    try { navigate(urlToPagePath(target.redirect.startsWith("http") ? target.redirect : `https://${target.redirect}`), { replace: true }); }
    catch { /* falls through to the error state below */ }
  }, [target.redirect, navigate]);

  const product = useStore(s => s.product);
  const source = useStore(s => s.source);
  const warnings = useStore(s => s.warnings);
  const session = useStore(s => s.session);
  const agentTrace = useStore(s => s.agentTrace);
  const { setProduct, setLoading, setError, selectVariant, togglePin, addToCart } = useStore.getState();

  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [err, setErr] = useState<LoadError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [qty, setQty] = useState(1);
  const [flash, setFlash] = useState<{ id: string; kind: string; variantId?: string } | null>(null);

  // load
  useEffect(() => {
    const url = target.url;
    if (!url) return;
    let cancelled = false;
    setErr(null);
    setLoading(true);
    loadExtract(url)
      .then(r => {
        if (cancelled) return;
        if (r.ok) { setProduct(r.product, r.source, r.warnings); setLoadedFor(url); setQty(1); }
        else { setErr({ code: r.code, message: r.error }); setError(r.error); }
      })
      .catch(e => { if (!cancelled) { const message = e instanceof Error ? e.message : String(e); setErr({ code: "fetch_failed", message }); setError(message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target.url, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // WebMCP tools: registered once; register.ts re-syncs itself on product + policy changes.
  useEffect(() => registerPageTools(), []);

  // E2E hook
  useEffect(() => {
    window.__agentpdp = {
      tools: () => useStore.getState().registeredTools,
      call: (name, args = {}) => isToolName(name) ? guardedHandler(name)(args) : Promise.resolve({ ok: false, code: "unknown_tool", error: `No tool named ${name}` }),
    };
    return () => { delete window.__agentpdp; };
  }, []);

  useEffect(() => {
    document.title = product && loadedFor === target.url ? `${product.title} · agent-ready` : "AgentPDP";
  }, [product, loadedFor, target.url]);

  // agent trace → 1.4 s flash on the element the tool touched (the toast reads the store itself)
  useEffect(() => {
    if (!agentTrace) return;
    setFlash({ id: agentTrace.id, kind: agentTrace.kind, variantId: agentTrace.variantId });
    const t = setTimeout(() => setFlash(f => (f?.id === agentTrace.id ? null : f)), 1400);
    return () => clearTimeout(t);
  }, [agentTrace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !!product && loadedFor === target.url;
  const selected = ready ? product!.variants.find(v => v.id === session.selectedVariantId) ?? product!.variants[0] : undefined;
  const cartCount = session.cart.reduce((n, l) => n + l.qty, 0);
  const cartLink = ready && session.cart.length ? checkoutUrl(product!, session.cart).url : null;

  const onHumanAdd = useCallback(() => {
    if (!product || !selected || selected.available === false) return;
    addToCart({ variantId: selected.id, qty, title: variantLabel(selected), price: selected.price }, "human");
    const { url } = checkoutUrl(product, useStore.getState().session.cart, selected);
    window.open(url, "_blank", "noopener");
  }, [product, selected, qty, addToCart]);

  if (!target.url) {
    return (
      <main className="pdp-wrap">
        {target.redirect ? <ProductSkeleton /> : <ErrorState code="invalid_url" message="This address has no product URL. Use /p/<host>/<path> or /p?url=https://…" />}
      </main>
    );
  }

  const host = (() => { try { return new URL(target.url).host; } catch { return ""; } })();
  const price = selected?.price ?? product?.price;
  const compareAt = selected?.compareAtPrice ?? (selected ? undefined : product?.compareAtPrice);
  const showCompareAt = !!compareAt && !!price && compareAt.amount > price.amount;

  return (
    <main className="pdp-wrap" data-testid="product-page">
      <header className="pdp-top">
        <nav className="pdp-crumb" aria-label="Breadcrumb">
          <Link to="/">AgentPDP</Link>
          <span className="sep">/</span>
          <span>Agent-ready page for <b>{hostLabel(host)}</b></span>
          <span className="sep">·</span>
          <a href={product?.canonicalUrl ?? target.url} target="_blank" rel="noopener noreferrer">Original page ↗</a>
        </nav>
        <div className="pdp-topright">
          {cartCount > 0 && (
            cartLink
              ? <a className="pill cart-pill" href={cartLink} target="_blank" rel="noopener noreferrer" data-testid="cart-badge">Cart · {cartCount}</a>
              : <span className="pill" data-testid="cart-badge">Cart · {cartCount}</span>
          )}
          <SiteToolsBadge />
        </div>
      </header>

      <AgentNotice />
      {ready && warnings.length > 0 && (
        <ul className="warn-list" data-testid="warnings">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}

      {err && !ready && <ErrorState code={err.code} message={err.message} url={target.url} onRetry={() => setAttempt(a => a + 1)} />}
      {!err && !ready && <ProductSkeleton />}

      {ready && product && (
        <div className="pdp-grid">
          <Gallery images={product.images} alt={product.title} preferred={selected?.imageUrl} />

          <section aria-label="Product details">
            {product.brand && <p className="pdp-brand">{product.brand}</p>}
            <h1 className="pdp-title" data-testid="product-title">{product.title}</h1>
            <div className="pdp-price" data-testid="price">
              <span className="now">{formatMoney(price)}</span>
              {showCompareAt && <span className="was">{formatMoney(compareAt)}</span>}
              {product.priceRange && product.priceRange.min.amount !== product.priceRange.max.amount && (
                <span className="range">{formatMoney(product.priceRange.min)} – {formatMoney(product.priceRange.max)} across variants</span>
              )}
            </div>
            {product.rating && <div className="pdp-rating">{product.rating.value.toFixed(1)} / 5{product.rating.count ? ` · ${product.rating.count} ratings` : ""}</div>}

            <VariantPicker product={product} selected={selected} onSelect={id => selectVariant(id, "human")} flashVariantId={flash?.kind === "select" ? flash.variantId : undefined} />

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                className={`pill ${selected?.available === true ? "ok" : selected?.available === false ? "bad" : "warn"}`}
                data-testid="availability"
              >
                {selected?.available === true ? "In stock" : selected?.available === false ? "Out of stock" : "Availability unknown"}
              </span>
              {selected && product.variants.length > 1 && <span className="muted" style={{ fontSize: 13 }}>{variantLabel(selected)}{selected.sku ? ` · ${selected.sku}` : ""}</span>}
              {selected && session.pinned.includes(selected.id) && <span className="pill">Pinned</span>}
            </div>

            <div className="pdp-actions">
              <label className="muted" style={{ fontSize: 13 }}>
                Qty{" "}
                <select value={qty} onChange={e => setQty(Number(e.target.value))} aria-label="Quantity" data-testid="quantity">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button
                type="button"
                className={`btn primary${flash?.kind === "cart" ? " agent-flash" : ""}`}
                data-testid="add-to-cart"
                disabled={!selected || selected.available === false}
                onClick={onHumanAdd}
                title={product.cart.kind === "shopify_permalink" ? "Adds to the cart here and opens the store's cart" : "Opens the store's product page"}
              >
                {selected?.available === false ? "Out of stock" : "Add to cart"}
              </button>
              <button
                type="button"
                className="btn"
                data-testid="pin-variant"
                aria-pressed={!!selected && session.pinned.includes(selected.id)}
                disabled={!selected}
                onClick={() => selected && togglePin(selected.id)}
              >
                {selected && session.pinned.includes(selected.id) ? "Unpin" : "Pin"}
              </button>
            </div>

            {product.description && (
              <section className="pdp-section" aria-label="Description">
                <h3>Description</h3>
                <p className="pdp-desc" data-testid="description">{product.description}</p>
              </section>
            )}

            <SpecsTable specs={product.specs} />

            <div className="pdp-source" data-testid="source-note">
              {source ? SOURCE_NOTE[source] : "Read from the product page"} · {new Date(product.extractedAt).toLocaleString()}.
              {product.cart.kind === "shopify_permalink" ? " Add to cart links straight into the store's cart." : " This store has no programmatic cart; add to cart opens the store's page."}
            </div>
          </section>

          <div className="pdp-rail"><MerchantPanel /></div>
        </div>
      )}

      <ConfirmDialog />
      <AgentToast />
      <CompareDrawer />
    </main>
  );
}
