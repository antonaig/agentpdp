# Testing WebMCP tools without ChatGPT

The judges test in the ChatGPT desktop app's built-in browser (Cmd+Shift+B). That app is not installed on the build machine, so the end-to-end suite uses **Google Chrome 152 with the WebMCP runtime flags**, which exposes the same `document.modelContext` API the page registers against.

## Verified facts (2026-09-04, Chrome 152.0.7977, Playwright channel "chrome")
- Launch args: `--enable-blink-features=WebMCP,WebMCPTesting`. With them, `document.modelContext` exists with `registerTool`, `getTools`, `executeTool`, `ontoolchange`. `navigator.modelContext` is not present in 152.
- `registerTool(tool, { signal })` and `signal.abort()` unregister the tool (verified with `getTools()`).
- The API exists on real origins: https and http://localhost / 127.0.0.1 (verified, `window.originAgentCluster === true`); on `data:` URLs it is absent.
- `--enable-features=WebMCP` alone does nothing. The chrome://flags entry is `enable-webmcp-testing`.
- DevTools protocol domain `WebMCP` (`WebMCP.enable`, events `toolsAdded`, `toolsRemoved`, `toolInvoked`, `toolResponded`, method `invokeTool`) exists; `toolsAdded` fires with full tool descriptors when a page registers.

## How the E2E suite invokes tools natively
```js
const tools = await page.evaluate(() => document.modelContext.getTools());
const result = await page.evaluate(async ([name, args]) => {
  const t = (await document.modelContext.getTools()).find(x => x.name === name);
  return document.modelContext.executeTool(t, JSON.stringify(args));
}, ["list_variants", { available_only: true }]);
```
`executeTool` runs the page's own `execute` handler, so it exercises the policy gate, confirm flow, rate limit and ledger exactly as an agent call would. Nothing is simulated; the page never fakes tool traffic.

## What the E2E suite must prove (per generated page)
1. Exactly the 8 tools from `shared/tools.ts` are registered; annotations match (`readOnlyHint` on read tools, `consequentialHint` on `add_to_cart`).
2. `list_variants` → real variants; `select_variant` changes the on-screen selection and logs a ledger row.
3. `add_to_cart` under policy `confirm` blocks until the on-page Approve is clicked, then returns a checkout URL of the form `https://<store>/cart/<variant>:<qty>` for Shopify products.
4. Setting `add_to_cart` policy to `off` in the merchant panel removes it from `getTools()`; `on` restores it.
5. `get_session_state` reflects a human click (variant selection) made through the UI.
6. Generator page: `make_agent_ready(url)` returns the agent-ready page URL.

## Visual QA rule
Screenshots on this build machine can lie (headless crop, sleeping display). Verify layout with DOM rects and computed styles first; use screenshots only as a secondary check.
