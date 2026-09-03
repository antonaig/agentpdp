// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Node 22+ shadows `localStorage` with an experimental global that is undefined without --localstorage-file, so
// vitest's jsdom never exposes its own. Polyfill an in-memory Storage before the store module (persist) loads.
vi.hoisted(() => {
  const g = globalThis as any;
  if (!g.localStorage) {
    const m = new Map<string, string>();
    const storage = {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, String(v)); },
      removeItem: (k: string) => { m.delete(k); },
      clear: () => { m.clear(); },
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
    };
    Object.defineProperty(g, "localStorage", { value: storage, configurable: true, writable: true });
  }
});
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { useStore } from "@/state/store";
import { DEFAULT_POLICY, type LedgerEntry } from "@shared/types";
import { PolicyTable } from "@/components/merchant/PolicyTable";
import { LedgerTable } from "@/components/merchant/LedgerTable";
import { Counters } from "@/components/merchant/Counters";
import { MerchantPanel, COLLAPSED_KEY } from "@/components/merchant/MerchantPanel";
import { computeCounters, hhmmss, ledgerFileName, truncate } from "@/components/merchant/helpers";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; host: HTMLElement }[] = [];
function mount(el: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  mounted.push({ root, host });
  return host;
}
afterEach(() => {
  for (const m of mounted) { act(() => m.root.unmount()); m.host.remove(); }
  mounted = [];
});

function entry(partial: Partial<LedgerEntry> & Pick<LedgerEntry, "tool" | "outcome">): LedgerEntry {
  return { id: crypto.randomUUID(), ts: new Date().toISOString(), args: {}, ms: 3, resultSummary: "", agent: "webmcp-agent", ...partial };
}

beforeEach(() => {
  window.localStorage.clear();
  useStore.setState({ policy: DEFAULT_POLICY, ledger: [], session: { pinned: [], cart: [], humanActions: 0 }, agentApi: "none", registeredTools: [], product: null });
});

describe("PolicyTable", () => {
  it("renders the 8 tools with read/write labels", () => {
    const host = mount(<PolicyTable />);
    const rows = host.querySelectorAll("tr[data-tool]");
    expect(rows.length).toBe(8);
    expect(host.querySelector('tr[data-tool="add_to_cart"]')!.textContent).toContain("write · purchase path");
    expect(host.querySelector('tr[data-tool="get_product"]')!.textContent).toContain("read");
    expect(host.querySelector('tr[data-tool="select_variant"] .mp-kind')!.textContent).toBe("write");
    // default: add_to_cart is confirm
    expect(host.querySelector('tr[data-tool="add_to_cart"]')!.textContent).toContain("human taps to approve");
  });

  it("segmented control calls setToolPolicy and shows the Off note", () => {
    const host = mount(<PolicyTable />);
    const off = host.querySelector<HTMLButtonElement>('[data-testid="policy-add_to_cart-off"]')!;
    act(() => off.click());
    expect(useStore.getState().policy.tools.add_to_cart).toBe("off");
    expect(off.getAttribute("aria-pressed")).toBe("true");
    const row = off.closest("tr")!;
    expect(row.textContent).toContain("hidden from agents");

    const on = host.querySelector<HTMLButtonElement>('[data-testid="policy-add_to_cart-on"]')!;
    act(() => on.click());
    expect(useStore.getState().policy.tools.add_to_cart).toBe("on");
    expect(row.textContent).not.toContain("hidden from agents");
    expect(row.textContent).not.toContain("human taps to approve");
  });

  it("global rules write to the store and reset restores defaults", () => {
    const host = mount(<PolicyTable />);
    const sw = host.querySelector<HTMLInputElement>('input[role="switch"]')!;
    act(() => sw.click());
    expect(useStore.getState().policy.hideCompareAtPrice).toBe(true);

    const sel = host.querySelector<HTMLSelectElement>("select")!;
    act(() => { sel.value = "10"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(useStore.getState().policy.rateLimitPerMinute).toBe(10);

    const reset = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Reset to defaults")!;
    act(() => reset.click());
    expect(useStore.getState().policy).toEqual(DEFAULT_POLICY);
  });
});

describe("LedgerTable", () => {
  it("shows the empty state", () => {
    const host = mount(<LedgerTable />);
    expect(host.textContent).toContain("No agent calls yet.");
    expect(host.querySelectorAll('[data-testid="ledger-row"]').length).toBe(0);
  });

  it("renders rows newest first with outcome pills and truncated args", () => {
    const longArgs = { question: "x".repeat(100) };
    useStore.setState({
      ledger: [
        entry({ tool: "add_to_cart", outcome: "confirmed", ts: "2026-09-04T03:00:02.000Z", args: { variant_id: "1", quantity: 1 } }),
        entry({ tool: "ask_about_product", outcome: "error", ts: "2026-09-04T03:00:01.000Z", args: longArgs }),
        entry({ tool: "get_product", outcome: "blocked", ts: "2026-09-04T03:00:00.000Z" }),
      ],
    });
    const host = mount(<LedgerTable />);
    const rows = Array.from(host.querySelectorAll<HTMLTableRowElement>('[data-testid="ledger-row"]'));
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain("add_to_cart");
    expect(rows[2].textContent).toContain("get_product");
    expect(rows[0].querySelector(".pill")!.className).toContain("ok");
    expect(rows[1].querySelector(".pill")!.className).toContain("bad");
    expect(rows[2].querySelector(".pill")!.className).toContain("warn");

    const args = rows[1].querySelector<HTMLTableCellElement>(".mp-args")!;
    expect(args.textContent!.length).toBeLessThanOrEqual(60);
    expect(args.textContent!.endsWith("…")).toBe(true);
    act(() => args.click());
    expect(args.textContent).toContain("x".repeat(100));

    const clear = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Clear")!;
    act(() => clear.click());
    expect(useStore.getState().ledger.length).toBe(0);
    expect(host.textContent).toContain("No agent calls yet.");
  });

  it("updates live when the store logs a call", () => {
    const host = mount(<LedgerTable />);
    act(() => { useStore.getState().log({ tool: "list_variants", args: { available_only: true }, outcome: "ok", ms: 4, resultSummary: "13 variants", agent: "webmcp-agent" }); });
    expect(host.querySelectorAll('[data-testid="ledger-row"]').length).toBe(1);
    expect(host.textContent).toContain("list_variants");
  });
});

describe("counters", () => {
  it("computeCounters counts calls, carts, blocked and human actions", () => {
    const ledger = [
      entry({ tool: "add_to_cart", outcome: "ok" }),
      entry({ tool: "add_to_cart", outcome: "confirmed" }),
      entry({ tool: "add_to_cart", outcome: "denied" }),
      entry({ tool: "get_product", outcome: "ok" }),
      entry({ tool: "get_product", outcome: "blocked" }),
      entry({ tool: "list_variants", outcome: "rate_limited" }),
      entry({ tool: "ask_about_product", outcome: "error" }),
    ];
    expect(computeCounters(ledger, { humanActions: 5 })).toEqual({ calls: 7, carts: 2, blocked: 3, human: 5 });
    expect(computeCounters([], { humanActions: 0 })).toEqual({ calls: 0, carts: 0, blocked: 0, human: 0 });
  });

  it("Counters renders from the store", () => {
    useStore.setState({ ledger: [entry({ tool: "add_to_cart", outcome: "ok" }), entry({ tool: "get_product", outcome: "denied" })], session: { pinned: [], cart: [], humanActions: 2 } });
    const host = mount(<Counters />);
    expect(host.querySelector('[data-testid="counter-calls"] b')!.textContent).toBe("2");
    expect(host.querySelector('[data-testid="counter-carts"] b')!.textContent).toBe("1");
    expect(host.querySelector('[data-testid="counter-blocked"] b')!.textContent).toBe("1");
    expect(host.querySelector('[data-testid="counter-human"] b')!.textContent).toBe("2");
  });
});

describe("MerchantPanel", () => {
  it("is expanded by default, collapses, and remembers it", () => {
    const host = mount(<MerchantPanel />);
    expect(host.textContent).toContain("Merchant view");
    expect(host.textContent).toContain("No agent connected");
    expect(host.querySelector('[data-testid="policy-add_to_cart-off"]')).not.toBeNull();
    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="merchant-panel-toggle"]')!;
    act(() => toggle.click());
    expect(host.querySelector('[data-testid="policy-add_to_cart-off"]')).toBeNull();
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe("1");
    act(() => toggle.click());
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe("0");
  });

  it("shows the agent status line from the store", () => {
    useStore.setState({ agentApi: "document.modelContext", registeredTools: ["get_product", "list_variants", "select_variant", "check_availability", "ask_about_product", "add_to_cart", "compare_with", "get_session_state"] });
    const host = mount(<MerchantPanel />);
    expect(host.textContent).toContain("Agent API: document.modelContext · 8 tools registered");
  });
});

describe("helpers", () => {
  it("formats time, truncates, names the export", () => {
    expect(hhmmss("not a date")).toBe("--:--:--");
    expect(hhmmss(new Date(2026, 8, 4, 9, 5, 7).toISOString())).toBe("09:05:07");
    expect(truncate("abc", 60)).toBe("abc");
    expect(truncate("a".repeat(61), 60)).toBe("a".repeat(59) + "…");
    expect(ledgerFileName("www.brooklinen.com")).toBe("agentpdp-ledger-www.brooklinen.com.json");
  });
});
