import type { LedgerEntry, LedgerOutcome, SessionState } from "@shared/types";
import type { ToolDef } from "@shared/tools";

/** Pure helpers for the merchant panel. Kept free of React so tests and the generator page can reuse them. */

export type ToolKind = "read" | "write" | "write · purchase path";

export function toolKind(def: Pick<ToolDef, "annotations">): ToolKind {
  if (def.annotations.readOnlyHint) return "read";
  if (def.annotations.consequentialHint) return "write · purchase path";
  return "write";
}

export function outcomeTone(o: LedgerOutcome): "ok" | "warn" | "bad" {
  if (o === "ok" || o === "confirmed") return "ok";
  if (o === "error") return "bad";
  return "warn"; // denied · blocked · rate_limited
}

export function hhmmss(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatArgs(args: unknown, pretty = false): string {
  if (args === undefined || args === null) return "{}";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args, null, pretty ? 2 : 0) ?? String(args);
  } catch {
    return String(args);
  }
}

export function truncate(s: string, max = 60): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export interface Counters { calls: number; carts: number; blocked: number; human: number }

export function computeCounters(ledger: LedgerEntry[], session: Pick<SessionState, "humanActions">): Counters {
  let carts = 0;
  let blocked = 0;
  for (const e of ledger) {
    if (e.tool === "add_to_cart" && (e.outcome === "ok" || e.outcome === "confirmed")) carts++;
    if (e.outcome === "blocked" || e.outcome === "denied" || e.outcome === "rate_limited") blocked++;
  }
  return { calls: ledger.length, carts, blocked, human: session.humanActions };
}

export function ledgerFileName(host: string): string {
  const safe = host.replace(/[^a-z0-9.-]/gi, "_").replace(/^_+|_+$/g, "");
  return `agentpdp-ledger-${safe || "page"}.json`;
}

/** Downloads the ledger as JSON. No-op where object URLs are unavailable (tests). */
export function exportLedgerJson(ledger: LedgerEntry[], host: string): void {
  if (typeof URL.createObjectURL !== "function") return;
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), host, entries: ledger }, null, 2);
  const href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = ledgerFileName(host);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
