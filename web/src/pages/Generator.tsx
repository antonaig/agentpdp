import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { urlToPagePath } from "@/lib/api";
import { registerGeneratorTools, type GeneratorStatus } from "@/webmcp/generatorTool";
import { EXAMPLE_URLS } from "@/components/generator/examples";
import { UrlForm } from "@/components/generator/UrlForm";
import { Footer, HowItWorks, Limits, WhatAgentsGet } from "@/components/generator/Sections";
import "@/components/generator/generator.css";

/** `/` — paste a product page URL, get `/p/<host>/<path>`. Also registers make_agent_ready + list_examples for agents. */
export function GeneratorPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<GeneratorStatus>({ api: "none", tools: 0 });

  useEffect(() => registerGeneratorTools({ navigate: (p) => navigate(p), onStatus: setStatus }), [navigate]);

  const go = (url: string) => navigate(urlToPagePath(url));
  const badge = status.api === "none" ? "No agent connected" : `${status.tools} site tools on this page`;

  return (
    <main className="gen">
      <header className="gen-top container">
        <Link to="/" className="gen-mark">AgentPDP</Link>
        <span className={`pill${status.api === "none" ? "" : " agent"}`} title={status.api === "none" ? undefined : status.api} data-agent={status.api}>{badge}</span>
      </header>

      <section className="gen-hero container">
        <h1>Make any product page agent-ready.</h1>
        <p className="gen-sub">Paste a product page URL. Get a page agents can use through site tools, with a merchant panel that shows and controls what they do.</p>
        <UrlForm onSubmit={go} />
        <div className="gen-chips" aria-label="Example product pages">
          <span className="gen-chips-label">Try</span>
          {EXAMPLE_URLS.map((ex) => (
            <button key={ex.url} type="button" className="gen-chip" title={ex.url} onClick={() => go(ex.url)}>{ex.label}</button>
          ))}
        </div>
      </section>

      <HowItWorks />
      <WhatAgentsGet />
      <Limits />
      <Footer />
    </main>
  );
}
