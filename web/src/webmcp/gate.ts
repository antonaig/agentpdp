import type { ToolName, LedgerOutcome } from "@shared/types";
import { useStore } from "@/state/store";
import { agentLabel } from "./modelContext";
import { formatMoney, variantLabel, truncate, safeStringify } from "@/lib/format";
import type { ToolArgs, ToolHandler, ToolResult } from "./handlers";

/**
 * guard(tool, handler) wraps every execute():
 *   timer → rate limit (sliding 60 s window) → policy check (off ⇒ blocked) → confirm gate (await the human) → handler (try/catch)
 *   → compare-at-price filter → ledger entry.
 * Never throws. Always returns a JSON-serializable object; success carries `ok: true`.
 */
export type GuardedHandler = (args?: ToolArgs | string | null) => Promise<ToolResult>;

const WINDOW_MS = 60_000;
let callTimes: number[] = [];
/** Test hook: forget the sliding window. */
export function resetRateLimit(): void { callTimes = []; }

function checkRateLimit(limit: number): { limited: boolean; retryInSec: number } {
  if (!limit || limit <= 0) return { limited: false, retryInSec: 0 };
  const now = Date.now();
  callTimes = callTimes.filter(t => now - t < WINDOW_MS);
  if (callTimes.length >= limit) {
    return { limited: true, retryInSec: Math.max(1, Math.ceil((WINDOW_MS - (now - callTimes[0])) / 1000)) };
  }
  callTimes.push(now);
  return { limited: false, retryInSec: 0 };
}

// Confirms are serialized so two agent calls never race for the one dialog.
let confirmChain: Promise<unknown> = Promise.resolve();
function askHuman(tool: ToolName, args: ToolArgs, summary: string): Promise<boolean> {
  const run = () => new Promise<boolean>(resolve => useStore.getState().requestConfirm({ tool, args, summary, resolve }));
  const p = confirmChain.then(run, run);
  confirmChain = p.catch(() => undefined);
  return p;
}

/** Human-readable one-liner for the confirm dialog and the ledger. */
export function confirmSummary(tool: ToolName, args: ToolArgs): string {
  const p = useStore.getState().product;
  const byId = (id: unknown) => p?.variants.find(v => String(v.id) === String(id));
  switch (tool) {
    case "add_to_cart": {
      const qty = Number(args.quantity ?? 1) || 1;
      const v = byId(args.variant_id);
      return v ? `Add ${variantLabel(v)} ×${qty} (${formatMoney(v.price)}) to cart` : `Add variant ${String(args.variant_id ?? "?")} ×${qty} to cart`;
    }
    case "select_variant": {
      const v = byId(args.variant_id);
      if (v) return `Select ${variantLabel(v)}`;
      if (args.options && typeof args.options === "object") return `Select ${Object.values(args.options as Record<string, unknown>).join(" / ")}`;
      return "Select a variant";
    }
    case "check_availability": { const v = byId(args.variant_id); return `Check stock for ${v ? variantLabel(v) : String(args.variant_id ?? "a variant")}`; }
    case "compare_with": return `Compare with ${truncate(String(args.url ?? ""), 80)}`;
    case "ask_about_product": return `Answer "${truncate(String(args.question ?? ""), 80)}"`;
    case "get_product": return "Read the product record";
    case "list_variants": return "List the variants";
    case "get_session_state": return "Read your selections, cart and policies";
    default: return `Run ${tool}`;
  }
}

/** Deep-strip compare-at prices from anything we hand to an agent when the merchant hides them. */
export function stripCompareAt<T>(value: T): T {
  const HIDDEN = new Set(["compareAtPrice", "compare_at_price", "compareAt", "compare_at"]);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (!HIDDEN.has(k)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

const now = () => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());

function parseArgs(raw: ToolArgs | string | null | undefined): ToolArgs {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as ToolArgs;
  if (typeof raw === "string" && raw.trim()) {
    try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as ToolArgs; } catch { /* fall through */ }
  }
  return {};
}

function summarize(result: ToolResult): string {
  if (result.ok === false) return truncate(`${String(result.code ?? "error")}: ${String(result.error ?? "")}`, 140);
  if (typeof result.message === "string" && result.message) return truncate(result.message, 140);
  if (typeof result.answer === "string" && result.answer) return truncate(result.answer, 140);
  return truncate(safeStringify(result), 140);
}

function normalize(r: unknown): ToolResult {
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const obj = r as ToolResult;
    return "ok" in obj ? obj : { ok: true, ...obj };
  }
  return { ok: true, value: r === undefined ? null : r };
}

export function guard(tool: ToolName, handler: ToolHandler): GuardedHandler {
  return async (rawArgs) => {
    const t0 = now();
    const args = parseArgs(rawArgs);
    const store = useStore.getState();
    const agent = agentLabel(store.agentApi);

    const finish = (outcome: LedgerOutcome, result: ToolResult): ToolResult => {
      const out = store.policy.hideCompareAtPrice ? stripCompareAt(result) : result;
      const ms = Math.round(now() - t0);
      try {
        useStore.getState().log({ tool, args, outcome, ms, resultSummary: summarize(out), agent });
      } catch { /* the ledger must never break a tool call */ }
      return out;
    };

    // 1. rate limit
    const rl = checkRateLimit(store.policy.rateLimitPerMinute);
    if (rl.limited) {
      return finish("rate_limited", { ok: false, code: "rate_limited", error: `This page allows ${store.policy.rateLimitPerMinute} tool calls per minute. Try again in about ${rl.retryInSec} s.`, retry_in_seconds: rl.retryInSec });
    }

    // 2. policy (defensive: an "off" tool is unregistered, but a stale handle may still call us)
    const policy = store.policy.tools[tool];
    if (policy === "off") {
      return finish("blocked", { ok: false, code: "blocked", error: `The merchant has turned ${tool} off on this page.` });
    }

    // 3. human confirm
    let confirmed = false;
    if (policy === "confirm") {
      const summary = confirmSummary(tool, args);
      let approved = false;
      try { approved = await askHuman(tool, args, summary); } catch { approved = false; }
      if (!approved) return finish("denied", { ok: false, code: "denied", error: "The shopper declined this action." });
      // The merchant may have switched the tool off while the dialog was open; the approval does not outrank that.
      if (useStore.getState().policy.tools[tool] === "off") {
        return finish("blocked", { ok: false, code: "blocked", error: `The merchant has turned ${tool} off on this page.` });
      }
      confirmed = true;
    }

    // 4. run
    try {
      const result = normalize(await handler(args));
      return finish(result.ok === false ? "error" : confirmed ? "confirmed" : "ok", result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return finish("error", { ok: false, code: "error", error: `${tool} failed: ${message}` });
    }
  };
}
