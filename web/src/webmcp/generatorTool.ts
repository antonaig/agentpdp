import { getModelContext, type ModelContextApi, type ModelContextToolDescriptor } from "./modelContext";
import { fetchExtract, urlToPagePath } from "@/lib/api";
import { TOOL_NAMES } from "@shared/types";
import { EXAMPLE_URLS } from "@/components/generator/examples";
import { normalizeProductUrl } from "@/components/generator/validate";
import { describeFetchError } from "@/components/generator/errors";

/** The generator page's own site tools. The 8 product tools live on the generated page (see register.ts). */
export const GENERATOR_TOOL_NAMES = ["make_agent_ready", "list_examples"] as const;

export interface GeneratorStatus { api: ModelContextApi; tools: number }

export interface RegisterGeneratorOptions {
  /** SPA navigation; defaults to a full `location.assign`. */
  navigate?: (path: string) => void;
  /** Called once after registration with what was found and how many tools registered. */
  onStatus?: (s: GeneratorStatus) => void;
  /** Delay between returning the tool result and opening the page. Default 400 ms. */
  navigateDelayMs?: number;
}

const NOTE = "Open page_url to use the tools; they are registered on that page only.";

export function registerGeneratorTools(opts: RegisterGeneratorOptions = {}): () => void {
  const { api, ctx } = getModelContext();
  if (!ctx) {
    opts.onStatus?.({ api, tools: 0 });
    return () => {};
  }

  const ac = new AbortController();
  const navigate = opts.navigate ?? ((path: string) => { location.assign(path); });
  const delay = opts.navigateDelayMs ?? 400;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tools: ModelContextToolDescriptor[] = [
    {
      name: "make_agent_ready",
      title: "Make a product page agent-ready",
      description:
        "Turn a product page URL into an agent-ready page with 8 site tools (get_product, list_variants, select_variant, check_availability, ask_about_product, add_to_cart, compare_with, get_session_state) and a merchant panel. Returns the page URL; this browser then opens it.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", format: "uri", description: "The product page URL, e.g. https://store.com/products/name" } },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: {},
      execute: async (input) => {
        const check = normalizeProductUrl(String(input?.url ?? ""));
        if (!check.ok) return { ok: false, code: "invalid_url", error: check.error };
        let result: Awaited<ReturnType<typeof fetchExtract>>;
        try {
          result = await fetchExtract(check.url);
        } catch (e) {
          return { ok: false, code: "fetch_failed", error: describeFetchError(e) };
        }
        if (!result.ok) return { ok: false, code: result.code, error: result.error };
        const path = urlToPagePath(check.url);
        // Return first, navigate after. The agent needs this result delivered before the route changes and this
        // page's tools are unregistered; a short delay lets the promise settle and the response leave the page.
        if (!ac.signal.aborted) {
          timer = setTimeout(() => { if (!ac.signal.aborted) navigate(path); }, delay);
        }
        return {
          ok: true,
          page_url: location.origin + path,
          title: result.product.title,
          source: result.source,
          tools: [...TOOL_NAMES],
          note: NOTE,
        };
      },
    },
    {
      name: "list_examples",
      title: "List example product pages",
      description: "Product pages verified to work with make_agent_ready, with the agent-ready page URL for each.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({
        examples: EXAMPLE_URLS.map((e) => ({ label: e.label, url: e.url, page_url: location.origin + urlToPagePath(e.url), note: e.note })),
      }),
    },
  ];

  let registered = 0;
  for (const t of tools) {
    try {
      Promise.resolve(ctx.registerTool(t, { signal: ac.signal })).catch((e) => console.warn(`[agentpdp] registerTool ${t.name} failed`, e));
      registered++;
    } catch (e) {
      console.warn(`[agentpdp] registerTool ${t.name} threw`, e);
    }
  }
  opts.onStatus?.({ api, tools: registered });

  return () => {
    ac.abort();
    if (timer) clearTimeout(timer);
    for (const t of tools) {
      try { void ctx.unregisterTool?.(t.name); } catch { /* implementations without unregisterTool rely on the signal */ }
    }
  };
}
