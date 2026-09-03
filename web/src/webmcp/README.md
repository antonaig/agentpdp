OWNER: webmcp+product agent.

Files to create here:
- `modelContext.ts`  — `getModelContext()` returning `document.modelContext ?? navigator.modelContext ?? null` and which one it found; minimal TS types for registerTool/unregisterTool/getTools/executeTool per the current spec.
- `register.ts`      — `registerPageTools(): () => void`. Registers the 8 tools from `shared/tools.ts` bound to `useStore`. One AbortController per tool so a policy flip to "off" unregisters exactly that tool (and re-registers on "on"/"confirm"). Subscribes to the store's policy so this is live.
- `gate.ts`          — wraps every execute(): rate limit → policy check (off ⇒ should never be reached, but return a structured error) → confirm gate (await human tap via `requestConfirm`) → run handler → ledger log with ms + outcome. Never throws raw; returns `{ ok:false, error }` shapes agents can read.
- `handlers.ts`      — the 8 handlers (pure functions over the store + `fetchExtract`/`askServer`).
- `deterministic.ts` — fallback answers for ask_about_product from specs/description when the server has no LLM.
