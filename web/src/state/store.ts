import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Product, PolicyState, LedgerEntry, SessionState, ToolName, ToolPolicy, CartLine, ExtractSource } from "@shared/types";
import { DEFAULT_POLICY } from "@shared/types";

/**
 * Page state shared by the product view, the WebMCP tool handlers and the merchant panel.
 * Tool handlers run outside React: always go through `useStore.getState()` / actions, never through hooks.
 * Policies + ledger persist per host in localStorage (merchant "settings" for the demo).
 */

export interface PendingConfirm {
  id: string;
  tool: ToolName;
  args: unknown;
  summary: string;              // human-readable: "Add Queen / White ×1 ($139) to cart"
  resolve: (approved: boolean) => void;
}

export interface PageStore {
  // product
  product: Product | null;
  source: ExtractSource | null;
  warnings: string[];
  loading: boolean;
  error: string | null;
  setProduct: (p: Product, source: ExtractSource, warnings: string[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;

  // human/agent shared session
  session: SessionState;
  selectVariant: (variantId: string, by: "human" | "agent") => void;
  togglePin: (variantId: string) => void;
  addToCart: (line: CartLine, by: "human" | "agent") => void;
  clearCart: () => void;

  // merchant policy
  policy: PolicyState;
  setToolPolicy: (tool: ToolName, p: ToolPolicy) => void;
  setHideCompareAtPrice: (v: boolean) => void;
  setRateLimit: (perMinute: number) => void;
  resetPolicy: () => void;

  // ledger
  ledger: LedgerEntry[];
  log: (e: Omit<LedgerEntry, "id" | "ts">) => LedgerEntry;
  clearLedger: () => void;

  // confirm gate (add_to_cart under "confirm" policy, or any tool set to confirm)
  pendingConfirm: PendingConfirm | null;
  requestConfirm: (req: Omit<PendingConfirm, "id">) => void;
  resolveConfirm: (approved: boolean) => void;

  // agent presence (set by the webmcp layer)
  agentApi: "document.modelContext" | "navigator.modelContext" | "none";
  setAgentApi: (a: PageStore["agentApi"]) => void;
  registeredTools: ToolName[];
  setRegisteredTools: (t: ToolName[]) => void;
}

const emptySession: SessionState = { pinned: [], cart: [], humanActions: 0 };

export const useStore = create<PageStore>()(
  persist(
    (set, get) => ({
      product: null, source: null, warnings: [], loading: false, error: null,
      setProduct: (product, source, warnings) => set({ product, source, warnings, error: null, session: { ...emptySession, selectedVariantId: product.variants.find(v => v.available !== false)?.id ?? product.variants[0]?.id } }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),

      session: emptySession,
      selectVariant: (variantId, by) => set((s) => ({ session: { ...s.session, selectedVariantId: variantId, humanActions: s.session.humanActions + (by === "human" ? 1 : 0) } })),
      togglePin: (variantId) => set((s) => ({ session: { ...s.session, pinned: s.session.pinned.includes(variantId) ? s.session.pinned.filter(id => id !== variantId) : [...s.session.pinned, variantId], humanActions: s.session.humanActions + 1 } })),
      addToCart: (line, by) => set((s) => {
        const existing = s.session.cart.find(l => l.variantId === line.variantId);
        const cart = existing ? s.session.cart.map(l => l.variantId === line.variantId ? { ...l, qty: l.qty + line.qty } : l) : [...s.session.cart, line];
        return { session: { ...s.session, cart, humanActions: s.session.humanActions + (by === "human" ? 1 : 0) } };
      }),
      clearCart: () => set((s) => ({ session: { ...s.session, cart: [] } })),

      policy: DEFAULT_POLICY,
      setToolPolicy: (tool, p) => set((s) => ({ policy: { ...s.policy, tools: { ...s.policy.tools, [tool]: p } } })),
      setHideCompareAtPrice: (hideCompareAtPrice) => set((s) => ({ policy: { ...s.policy, hideCompareAtPrice } })),
      setRateLimit: (rateLimitPerMinute) => set((s) => ({ policy: { ...s.policy, rateLimitPerMinute } })),
      resetPolicy: () => set({ policy: DEFAULT_POLICY }),

      ledger: [],
      log: (e) => {
        const entry: LedgerEntry = { id: crypto.randomUUID(), ts: new Date().toISOString(), ...e };
        set((s) => ({ ledger: [entry, ...s.ledger].slice(0, 500), session: { ...s.session, lastToolCall: entry.ts } }));
        return entry;
      },
      clearLedger: () => set({ ledger: [] }),

      pendingConfirm: null,
      requestConfirm: (req) => set({ pendingConfirm: { id: crypto.randomUUID(), ...req } }),
      resolveConfirm: (approved) => { const p = get().pendingConfirm; set({ pendingConfirm: null }); p?.resolve(approved); },

      agentApi: "none",
      setAgentApi: (agentApi) => set({ agentApi }),
      registeredTools: [],
      setRegisteredTools: (registeredTools) => set({ registeredTools }),
    }),
    {
      name: "agentpdp",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ policy: s.policy, ledger: s.ledger }),
    },
  ),
);
