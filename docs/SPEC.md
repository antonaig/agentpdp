# Build spec — "AgentPDP" (working title) · WebMCP Challenge entry

**Written:** 2026-09-04 01:35 IDT · **Deadline:** 11:00 IDT · **Status:** awaiting GO

## One sentence
Paste any product page URL and get a hosted, agent-ready version of it: a clean human PDP that registers WebMCP site tools bound to the real product data, with a merchant panel that shows every agent call and lets the merchant switch tools on, off, or behind a human confirm. One page is the wedge; the full `ai.brand.com` store is the upgrade.

## What the judges see (the 3-minute flow)
1. Generator page. Paste `https://www.brooklinen.com/products/<handle>` → "Make it agent-ready." Or say it to the agent: the generator registers `make_agent_ready(url)`, so in ChatGPT's browser "make this page agent-ready" works without clicking.
2. ~2 s later: `/p/brooklinen.com/products/<handle>`: title, gallery, price, variants, description, availability, and a "Site tools" badge listing 8 registered tools. Humans can click variants and add to cart normally.
3. In ChatGPT's browser: "Which sizes are in stock under $60? Add the queen to my cart." Agent calls `list_variants` → `check_availability` → `add_to_cart`. The page updates live (variant selected, cart badge), the ledger logs each call with latency and result. `add_to_cart` returns a **real Shopify cart permalink**; clicking it lands in the real Brooklinen cart with the item.
4. Merchant panel: flip "Agents may add to cart" to OFF → the tool vanishes from Site tools instantly (`toolchange`). Ask again → the agent can't. Flip to "Human confirms" → the agent's call raises an on-page confirm the human taps.
5. Stretch: `compare_with(url)` with an Allbirds PDP → side-by-side across two generated pages.
6. Close: "This is one page. Aigency does the whole store."

## Tools
**Generator page (1):** `make_agent_ready({url})` → generated URL, tool list, extraction source (`shopify` | `jsonld` | `og`).

**Generated page (8):**
| Tool | Annotation | Returns |
|---|---|---|
| `get_product` | readOnly | normalized product: title, brand, price, currency, description, images, specs, canonical URL |
| `list_variants` | readOnly | options (size/color), price per variant, availability |
| `select_variant({variant_id \| options})` | | selects on screen; returns selected state |
| `check_availability({variant_id})` | readOnly | Shopify: live `available`; else "unknown, no live inventory feed" (honest) |
| `ask_about_product({question})` | readOnly | answer grounded in extracted data; LLM if a key is configured, deterministic spec lookup otherwise |
| `add_to_cart({variant_id, quantity})` | **consequential** | Shopify: `/cart/{variant}:{qty}` permalink + on-page cart update; others: PDP URL with note. Gated by merchant policy |
| `compare_with({url})` | readOnly | side-by-side of two generated products (stretch) |
| `get_session_state` | readOnly | human's selections, cart, policies in force: the agent sees what the human did |

All registered on `document.modelContext` with `navigator.modelContext` fallback. No agent present → human page still renders with a "open in ChatGPT's browser or Chrome 149+ with the WebMCP flag" notice.

## Merchant control plane (right rail on every generated page)
- Per-tool policy: **On / Human confirms / Off**. Off = `AbortController` unregister → `toolchange`. Human confirms = on-page dialog before `execute` resolves.
- Price rule: show/hide compare-at prices to agents. Soft rate limit per session.
- Ledger: time, tool, args (truncated), ms, ok/err, user agent. Persists in localStorage, JSON export. Counters: calls, carts created.
- Honest framing: enforcement is client-side because that is where WebMCP executes; state is per-browser, not a merchant backend. Say so in README and video.

## Architecture
- Node 22 + Hono (TypeScript). Vite + React SPA for `/` (generator), `/p/:host/*` (product), `/compare`. One process serves API + static.
- `GET /api/extract?url=` → extraction ladder: (1) Shopify: URL matches `/products/<handle>` → `<origin>/products/<handle>.json` (verified live on Brooklinen: variants, prices, images, availability). (2) HTML → `<script type="application/ld+json">` Product / ProductGroup / Offer. (3) OpenGraph/meta fallback. In-memory cache 5 min.
- `POST /api/ask` → LLM answer grounded only in extracted data, if `LLM_API_KEY` set; else 501 and the tool falls back client-side.
- SSRF guard: https only, DNS-resolve and block private/loopback/link-local, redirects re-checked, 5 MB cap, 8 s timeout. Descriptive UA `AgentPDP/0.1 (+repo)`, browser-like UA as fallback.
- Tests: unit tests for the extraction ladder and SSRF guard; a DOM test that stubs `document.modelContext` and asserts registration, unregistration on policy change, and return shapes.
- Deploy: new DO droplet (fra1, 2 GB), systemd unit, Caddy reverse proxy with auto-TLS. Overnight hostname `<ip>.sslip.io`; morning: Itamar adds an A record (e.g. `pdp.aigency.ai`), Caddy picks it up.
- Repo: new public repo, MIT. README states prior vs new work: built new tonight; extraction-ladder idea from Aigency's `agentweb` experiment; tool shapes evolved from the WebMCP tools Aigency shipped in genui in March 2026 (not included).

## Video (<3 min, public YouTube, with audio)
Overnight cut: real footage from Chrome 152 with the WebMCP flag (tools invoked through the native API, nothing simulated), TTS narration, HyperFrames titles. Morning option: Itamar records the same flow in ChatGPT's desktop browser on the Air (script provided), I swap it in. Either cut is submittable.

## Timeline (IDT)
| Window | Work |
|---|---|
| 01:45–02:15 | repo scaffold, droplet + Caddy, deploy script |
| 02:15–03:30 | extraction ladder + SSRF guard + tests |
| 03:30–05:00 | product page UI + 8 tools + annotations + session state |
| 05:00–06:00 | merchant panel: policies, live unregister, ledger, confirm dialog |
| 06:00–06:30 | generator page + `make_agent_ready` + 5 verified example URLs |
| 06:30–07:15 | Chrome-flag end-to-end, fixes |
| 07:15–08:30 | video cut, README, Devpost description, prior-work note |
| 08:30 | handoff to Itamar: URL, repo, video, description, submit checklist |
| morning | Itamar: DNS record, ChatGPT-app test, YouTube upload, **Submit by 11:00** |

Buffer ≈ 1 h. If behind, cut in this order: `compare_with` → LLM answers (deterministic stays) → rate limit → HyperFrames titles (plain screen capture + TTS).

## Out of scope tonight
Accounts, persistence, non-Shopify live inventory, per-merchant custom domains (the `ai.brand.com` CNAME story is described, not built), payments, multi-page stores.

## Costs and risks
- Droplet ~$12/mo; LLM calls negligible; no domain purchase.
- Bot-walled stores fail extraction → demo only on verified URLs; description says "any page with Product schema, plus a Shopify fast path," never "any site."
- ChatGPT-browser behavior unverified until the Air test → the API is the documented one; Chrome-flag test overnight is the proxy.
- Video time → fallback is a plain screen capture with TTS.

## Decisions needed with the GO
1. Name (working: AgentPDP) or leave it to Mike later.
2. Demo brands: default Brooklinen + Allbirds (Shopify, no Aigency relationship). Veto any.
3. Repo owner: `aigencyai` or `antonaig`. MIT.
4. OK to configure a Groq or Anthropic key from the genui env on the droplet for `ask_about_product` (pennies), or deterministic only.
5. Devpost registration tonight.
