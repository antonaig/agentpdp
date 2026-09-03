# Devpost submission text (draft · revise against what shipped)

**Project name:** AgentPDP
**Tagline (≤ 60 chars):** Paste a product page. Get an agent-ready one.
**Live URL:** https://188-166-163-33.sslip.io (replace with the real hostname once DNS is set)
**Repo:** https://github.com/antonaig/agentpdp (MIT)
**Video:** (YouTube link)

## Inspiration
Every product page on the web was designed for a human with a mouse. Agents now arrive at those pages too, and today they scrape, guess, and mis-click. WebMCP fixes that for sites willing to rewrite their frontend. Most merchants will not, at least not this year. We wanted the shortest path from "here is a product page" to "here is a page an agent can use," with the merchant still in control of what the agent may do.

## What it does
Paste any product page URL. AgentPDP reads the page's product data and serves an agent-ready version of it on the fly:
- A clean, usable product page for the human (gallery, variants, price, availability, add to cart).
- Eight WebMCP site tools registered on that page, bound to the real product data: `get_product`, `list_variants`, `select_variant`, `check_availability`, `ask_about_product`, `add_to_cart`, `compare_with`, `get_session_state`. On Shopify stores, `add_to_cart` returns a real cart permalink that lands in the merchant's real cart.
- A merchant control plane on the same page: each tool can be On, Confirm (a human taps to approve), or Off (the tool is unregistered and disappears from the agent's list, live). A ledger records every agent call with arguments, outcome, latency and agent.
- The generator itself is agent-ready: `make_agent_ready(url)` lets an agent turn a page agent-ready without a human clicking.

## Human–agent collaboration
The human and the agent work on the same live page. When the agent selects a variant or adds to cart, the page shows it with an agent-colored trace. When the human pins a variant or changes the selection, `get_session_state` tells the agent. Purchase-path actions can be routed through an on-page human confirm. The merchant watches both sides in the ledger.

## How we built it
Node + Hono server, Vite + React page, TypeScript throughout. Extraction ladder: Shopify product JSON → schema.org JSON-LD (Product, ProductGroup, Offer) → microdata/OpenGraph → a headless-browser fetch for JS-rendered pages. Everything is stateless: a generated page is just `/p/<host>/<path>`, rendered from live extraction with a short cache. WebMCP tools are registered on `document.modelContext` (with the `navigator` alias as fallback), one AbortController per tool so merchant policy changes register and unregister tools live, with `readOnlyHint` / `consequentialHint` annotations. Deployed on a DigitalOcean droplet behind Caddy.

## Challenges
- Making "any product page" honest: bot-walled stores refuse automated fetches, so the ladder reports which step failed instead of pretending. The headless rung covers JS-rendered pages.
- Tool lifecycle: a tool that a merchant switches off must vanish from the agent's list immediately and come back cleanly; we tied each tool to its own AbortController and to the policy store.
- Testing without the judges' browser: we verified the page in Chrome with the WebMCP runtime flags, invoking tools through the native `executeTool` API, and separately in ChatGPT's desktop browser.

## Accomplishments
Real product pages from several brands become agent-ready in about two seconds. Real Shopify carts get filled by an agent call, with the human approving on screen. The merchant can change what agents may do while the agent is mid-task.

## What's next
Per-merchant hostnames (`ai.brand.com` via CNAME), a merchant dashboard that aggregates the ledger across shoppers, tool policies driven by inventory and pricing rules, and the whole-store version of the same idea. One page is the wedge; the whole store is the product.

## Built with
TypeScript, Node.js, Hono, React, Vite, zustand, Playwright, Caddy, DigitalOcean, WebMCP (`document.modelContext`).

## Prior work vs. new work (required by the rules)
Everything in this repository was written during the submission period. Ideas we reused from earlier Aigency work: an extraction-ladder experiment for agent-readable pages, and the shape of three shopping tools we shipped on our own conversational storefront in March 2026. None of that code is included.
