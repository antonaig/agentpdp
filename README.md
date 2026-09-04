# AgentPDP

**Paste a product page URL. Get an agent-ready version of it.**

A clean product page for the human, eight [WebMCP](https://webmachinelearning.github.io/webmcp/) site tools for the agent, and a merchant control plane that shows and governs what agents do — generated on the fly from the page's own product data. Built by [Aigency](https://aigency.ai) for the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/), September 2026. MIT.

- Live: https://188-166-163-33.sslip.io
- Try it: paste a product page URL on the home page, or open `/p/<host>/<path>` directly, e.g. [/p/www.brooklinen.com/products/luxe-core-sheet-set](https://188-166-163-33.sslip.io/p/www.brooklinen.com/products/luxe-core-sheet-set).
- In ChatGPT: desktop app → Work or Codex chat → Cmd+Shift+B → open the page → the site-tools arrow appears in the address bar → ask for what you want ("which sizes are in stock under $200? add the queen to my cart").

## What agents get on a generated page

| Tool | Kind | What it does |
|---|---|---|
| `get_product` | read | Normalized product: title, brand, price, description, images, options, specs, availability |
| `list_variants` | read | Every purchasable variant with id, options, price, availability; filters `available_only`, `max_price` |
| `select_variant` | write | Selects a variant on screen so the human sees it |
| `check_availability` | read | Live stock for Shopify products; honest "unknown" otherwise |
| `ask_about_product` | read | Answers grounded only in the page's product data |
| `add_to_cart` | write · purchase path | Adds to the cart and returns a checkout URL (a real Shopify cart permalink); merchant policy may require a human tap |
| `compare_with` | read | Side-by-side with another product page |
| `get_session_state` | read | What the human selected, pinned, carted, and which tools the merchant allows |

The generator page registers `make_agent_ready(url)` and `list_examples()`, so an agent can create an agent-ready page without a human clicking.

## The merchant control plane
Each tool is **On**, **Confirm** (a human taps to approve each call) or **Off** (the tool is unregistered and disappears from the agent's list, live). Global rules: hide compare-at prices from agents, per-session rate limit. A ledger records every agent call: time, tool, arguments, outcome, latency, agent. For this demo, policies and the ledger are stored in the browser; a merchant dashboard across shoppers is the next step.

## How it works
1. `GET /api/extract?url=` runs an extraction ladder behind an SSRF guard: **Shopify** product JSON → **schema.org JSON-LD** (Product, ProductGroup, Offer) → **microdata / OpenGraph** → **headless browser** render for JS-heavy pages, then the same parsers. Results are normalized to one `Product` shape (`shared/types.ts`) and cached for five minutes.
2. The page at `/p/<host>/<path>` renders the product and registers the tools from `shared/tools.ts` on `document.modelContext` (falls back to `navigator.modelContext`). One `AbortController` per tool: policy changes register and unregister tools live. Read tools carry `readOnlyHint`; `add_to_cart` carries `consequentialHint`.
3. A gate wraps every tool call: rate limit → policy → human confirm → handler → ledger. Errors are returned as structured objects agents can read; nothing throws raw.

Stateless by design: no accounts, no database. A generated page is just a URL.

## Run it locally
```bash
npm install
cp .env.example .env        # GROQ_API_KEY optional: enables LLM-grounded answers for ask_about_product
npm run dev                 # server on :8787, web on :5173
```
Then open http://localhost:5173 and paste a product URL. To exercise the tools without ChatGPT, run Chrome with `--enable-blink-features=WebMCP,WebMCPTesting` (see `docs/TESTING.md`).

## Test
```bash
npm run typecheck && npm test        # unit + DOM tests
E2E_BASE_URL=https://<host> npm run e2e   # native WebMCP tests in Chrome with the runtime flags
npx tsx server/scripts/matrix.ts     # live extraction matrix against real product pages
```

## Deploy
See `docs/DEPLOY.md` (DigitalOcean droplet, Caddy, systemd).

## What we verified (2026-09-04)
Live extraction matrix, real network, nothing mocked (`npx tsx server/scripts/matrix.ts`):

| Page | Result | Path |
|---|---|---|
| Brooklinen sheet set | 174 variants, real cart link | Shopify feed |
| Allbirds shoe | 13 variants, real cart link | Shopify feed |
| SKIMS bra | 65 variants, cart link inferred from variant ids | schema.org ProductGroup |
| Nike Air Force 1 | 22 sizes | schema.org ProductGroup |
| Zappos, Samsung, a WooCommerce shop | 1 variant each | schema.org Product |
| LEGO Millennium Falcon | 1 variant, through a Cloudflare challenge | headless render → JSON-LD |
| Lululemon | refused (Akamai bot wall, transport-level) | honest `blocked_by_site` |
| Bose, Gildan | no structured product data even after rendering | honest `no_product` |

End to end: 109 unit tests; 7 native WebMCP tests in Chrome 152 with the runtime flags against the deployed URL (register 8 tools, annotations, select → ledger, confirm-gated add_to_cart → Shopify permalink, policy Off/On live unregister, human → agent state, generator `make_agent_ready`).

## Limits, stated plainly
- Works on pages that publish product data (Shopify feed, schema.org, OpenGraph) or render it in the browser. Sites that block automated fetches at the transport level (Akamai on Lululemon) refuse; the page reports which step failed.
- Live availability only where the store exposes it (Shopify). Elsewhere the tool says "unknown" and why.
- Merchant policies are enforced in the page, which is where WebMCP executes; they are stored per browser for this demo.
- The API is same-origin by default: CORS allows only `PUBLIC_ORIGIN` (falling back to `*` when it is unset, as in local dev), and `/api/extract` and `/api/ask` are rate-limited per IP.
- Tested in Chrome 152 with the WebMCP runtime flags (`--enable-blink-features=WebMCP,WebMCPTesting`). Chrome 152 echoes only `readOnlyHint`/`untrustedContentHint` from `getTools()`; `consequentialHint` is passed at registration. Site tools in ChatGPT require the desktop app's built-in browser (Cmd+Shift+B) and a supported model.

## Prior work vs. new work
All code in this repository was written during the challenge submission period (Sep 3–4, 2026). Ideas carried over from earlier Aigency work, without code: an extraction-ladder experiment for agent-readable pages, and the shape of three shopping tools shipped on our conversational storefront in March 2026.

## License
MIT. See `LICENSE`.
