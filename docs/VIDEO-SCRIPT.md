# Demo video · target 2:30, hard cap 2:59 · public YouTube with audio

Footage rule: every tool call on screen is a real invocation (ChatGPT desktop browser, or Chrome 152 with the WebMCP runtime flags using the native API). Nothing simulated, no fake readouts.

| Time | Shot | Narration (TTS or Itamar) |
|---|---|---|
| 0:00–0:12 | Title card: "AgentPDP — make any product page agent-ready." | "Every product page was built for a human with a mouse. Agents arrive at those pages now too. Here is the shortest path from a product page to a page an agent can use, with the merchant still in control." |
| 0:12–0:40 | Generator: paste a Brooklinen product URL, click "Make it agent-ready". Cut to the generated page loading. Zoom on the Site tools badge: "8 site tools". | "Paste a product page URL. We read the page's own product data: the store's product feed, schema.org markup, or a rendered fetch. Two seconds later, the same product, on a page that registers eight WebMCP site tools." |
| 0:40–1:25 | ChatGPT desktop browser (or Chrome) beside the page. Prompt: "Which sizes are in stock under $60? Add the queen to my cart." Show: variants listed, the page's selection changing with the agent trace, the confirm dialog, tap Approve, checkout URL returned, click → real Brooklinen cart. Ledger rows appearing. | "The agent lists variants, checks availability, selects on screen, and asks to add to cart. The merchant has set add-to-cart to require a human tap. Approve, and the agent gets a real cart link for the real store. Every call lands in the ledger with its arguments and timing." |
| 1:25–1:55 | Merchant panel: flip add_to_cart to Off. Cut to the agent's tool list: add_to_cart gone. Ask again: the agent cannot. Flip back to Confirm. | "This is the part agents' browsers don't give merchants. Switch a tool off and it disappears from the agent's list, live. Switch it to confirm and a human is back in the loop. The ledger shows what agents did, and what they were not allowed to do." |
| 1:55–2:15 | Montage: three more real product pages generated (per the verified matrix), each showing the badge and a tool call. | "It works on any product page that publishes its data, from Shopify stores to schema.org markup to rendered pages. When a site blocks automated fetches, the page tells you which step failed instead of pretending." |
| 2:15–2:35 | Wedge card + repo. | "One page is the wedge. The whole store is the product: your domain, your rules, every agent. Open source, MIT, link below. Built by Aigency for the WebMCP Challenge." |

Assets: screen captures from Chrome with the flags (Playwright video, 1440×900), title cards via HyperFrames, TTS narration; optional swap-in of the ChatGPT desktop take recorded on the Air.
