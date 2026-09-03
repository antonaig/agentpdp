import { toolDefs, type ToolDef } from "@shared/tools";
import { TOOL_NAMES, type ToolName, type Product } from "@shared/types";
import { useStore } from "@/state/store";
import { getModelContext, type ModelContextToolDescriptor } from "./modelContext";
import { guard, type GuardedHandler } from "./gate";
import { handlers } from "./handlers";

/**
 * Tool lifecycle for a generated product page.
 *
 *  - One AbortController per tool. Policy `off` ⇒ abort() — the browser unregisters that one tool and fires `toolchange`.
 *    Hosts that ignore `{ signal }` get an explicit `unregisterTool(name)` right after the abort (harmless when both work).
 *  - `on` / `confirm` ⇒ the tool is registered (the confirm gate lives inside execute, so the tool stays visible).
 *  - The store is the trigger: a policy flip or a product change re-syncs. Descriptions embed brand + title, so a new
 *    product means a full unregister + register.
 *  - `store.registeredTools` mirrors what is registered, so the badge and get_session_state stay truthful.
 */

const guarded = new Map<ToolName, GuardedHandler>();
/** The gated handler for a tool — the same function the browser calls. Exposed on window.__agentpdp for E2E. */
export function guardedHandler(name: ToolName): GuardedHandler {
  let g = guarded.get(name);
  if (!g) { g = guard(name, handlers[name]); guarded.set(name, g); }
  return g;
}
export function isToolName(x: unknown): x is ToolName { return typeof x === "string" && (TOOL_NAMES as readonly string[]).includes(x); }

const productKey = (p: Product | null) => (p ? `${p.id}|${p.brand ?? ""}|${p.title}` : null);
const isThenable = (x: unknown): x is Promise<unknown> => !!x && typeof (x as Promise<unknown>).then === "function";

export function registerPageTools(): () => void {
  const { api, ctx } = getModelContext();
  useStore.getState().setAgentApi(api);
  if (!ctx) {
    useStore.getState().setRegisteredTools([]);
    return () => {};
  }

  const controllers = new Map<ToolName, AbortController>();
  let registeredFor: string | null = null;
  let disposed = false;

  const publish = () => useStore.getState().setRegisteredTools(TOOL_NAMES.filter(n => controllers.has(n)));

  const unregisterOne = (name: ToolName) => {
    const ac = controllers.get(name);
    if (!ac) return;
    controllers.delete(name);
    try { ac.abort(); } catch { /* ignore */ }
    if (typeof ctx.unregisterTool === "function") {
      try { const r = ctx.unregisterTool(name); if (isThenable(r)) r.catch(() => undefined); } catch { /* already gone */ }
    }
  };

  const registerOne = (def: ToolDef) => {
    const ac = new AbortController();
    controllers.set(def.name, ac);
    const tool: ModelContextToolDescriptor = {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations,
      execute: (input) => guardedHandler(def.name)(input),
    };
    const giveUp = (err: unknown) => {
      if (controllers.get(def.name) === ac) { controllers.delete(def.name); publish(); }
      console.warn(`[agentpdp] registerTool(${def.name}) failed`, err);
    };
    // A rejected/thrown registration is usually a stale duplicate: unregister explicitly and try once more.
    const retry = (err: unknown) => {
      if (ac.signal.aborted) return;
      try {
        if (typeof ctx.unregisterTool === "function") { const u = ctx.unregisterTool(def.name); if (isThenable(u)) u.catch(() => undefined); }
        const r2 = ctx.registerTool(tool, { signal: ac.signal });
        if (isThenable(r2)) r2.catch(giveUp);
      } catch (e2) { giveUp(e2 ?? err); }
    };
    try {
      const r = ctx.registerTool(tool, { signal: ac.signal });
      if (isThenable(r)) r.catch(retry);
    } catch (err) { retry(err); }
  };

  const sync = () => {
    if (disposed) return;
    const s = useStore.getState();
    const key = productKey(s.product);
    if (key !== registeredFor) {
      for (const n of [...controllers.keys()]) unregisterOne(n);
      registeredFor = key;
    }
    if (s.product) {
      for (const def of toolDefs(s.product.brand ?? "", s.product.title)) {
        const want = s.policy.tools[def.name] !== "off";
        const have = controllers.has(def.name);
        if (want && !have) registerOne(def);
        else if (!want && have) unregisterOne(def.name);
      }
    }
    publish();
  };

  sync();
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (s.product !== prev.product || s.policy.tools !== prev.policy.tools) sync();
  });

  return () => {
    disposed = true;
    unsubscribe();
    for (const n of [...controllers.keys()]) unregisterOne(n);
    useStore.getState().setRegisteredTools([]);
  };
}
