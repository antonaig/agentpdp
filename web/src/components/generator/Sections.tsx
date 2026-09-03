import { toolDefs } from "@shared/tools";
import type { ToolName } from "@shared/types";
import { toolKind } from "@/components/merchant/helpers";
import "./generator.css";

const DEFS = toolDefs("", "");

/** One plain line per tool. The full descriptions in shared/tools.ts are written for agents, with the product name inlined. */
const BLURB: Record<ToolName, string> = {
  get_product: "The normalized product: title, brand, price, description, images, options, specs, availability, canonical URL.",
  list_variants: "Every purchasable variant with id, option values, price and availability. Filters: in stock only, max price.",
  select_variant: "Selects a variant on screen so the human sees what the agent is talking about.",
  check_availability: "Live stock for a variant from the store's feed. Says unknown when there is no live signal.",
  ask_about_product: "Answers a question from the page's own data, and says when the page does not say.",
  add_to_cart: "Adds a variant and returns a real cart link. The merchant can require a human tap first.",
  compare_with: "Two products side by side: price, options, availability, key specs.",
  get_session_state: "What the human did: selected variant, pins, cart, and which tools are currently allowed.",
};

export function HowItWorks() {
  return (
    <section className="gen-section container" aria-labelledby="gen-how">
      <h2 id="gen-how">How it works</h2>
      <ol className="gen-steps">
        <li className="gen-step"><h3>Paste</h3><p>Any product page URL.</p></li>
        <li className="gen-step"><h3>We read the page's product data</h3><p>The store's Shopify feed, schema.org markup, or a rendered fetch.</p></li>
        <li className="gen-step"><h3>You get a page with 8 site tools and a merchant panel</h3><p>Agents use the tools. The panel shows and controls what they do.</p></li>
      </ol>
    </section>
  );
}

export function WhatAgentsGet() {
  return (
    <section className="gen-section container" aria-labelledby="gen-tools-h">
      <h2 id="gen-tools-h">What agents get</h2>
      <ul className="gen-tools">
        {DEFS.map((d) => {
          const kind = toolKind(d);
          return (
            <li key={d.name} className="gen-tool">
              <div className="gen-tool-head">
                <span className="mono">{d.name}</span>
                <span className={`gen-kind ${kind === "read" ? "read" : "write"}`}>{kind}</span>
              </div>
              <p>{BLURB[d.name]}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Limits() {
  return (
    <section className="gen-section gen-limits container" aria-labelledby="gen-limits-h">
      <h2 id="gen-limits-h">Limits</h2>
      <p>
        Works on pages that publish product data. Sites that block automated fetches may refuse; the page tells you which step failed.
        Policies and the ledger are stored in your browser for this demo; the merchant dashboard across shoppers is the next step.
      </p>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="gen-foot container">
      <span>Built by Aigency for the OpenAI WebMCP Challenge, Sep 2026. One page is the wedge; the whole store is ai.brand.com.</span>
      <a href="https://github.com/antonaig/agentpdp" target="_blank" rel="noreferrer">github.com/antonaig/agentpdp</a>
    </footer>
  );
}
