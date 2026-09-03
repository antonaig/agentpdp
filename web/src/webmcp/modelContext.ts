/**
 * Access to the browser's WebMCP entry point. Shared by the product page (8 tools) and the generator page (1 tool).
 * Spec: https://webmachinelearning.github.io/webmcp/  ·  ChatGPT site tools: https://learn.chatgpt.com/docs/webmcp
 * The getter moved from navigator.modelContext to document.modelContext in Aug 2026; Chrome keeps the old alias.
 */
export interface ModelContextToolDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean; destructiveHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown;
}
export interface ModelContext extends EventTarget {
  registerTool(tool: ModelContextToolDescriptor, options?: { signal?: AbortSignal; exposedTo?: string[] }): Promise<void> | void;
  unregisterTool?(name: string): Promise<void> | void;
  getTools?(options?: { fromOrigins?: string[] }): Promise<unknown[]>;
  executeTool?(tool: unknown, inputJson: string, options?: { signal?: AbortSignal }): Promise<unknown>;
}
export type ModelContextApi = "document.modelContext" | "navigator.modelContext" | "none";

export function getModelContext(): { api: ModelContextApi; ctx: ModelContext | null } {
  const d = (globalThis as any).document?.modelContext as ModelContext | undefined;
  if (d) return { api: "document.modelContext", ctx: d };
  const n = (globalThis as any).navigator?.modelContext as ModelContext | undefined;
  if (n) return { api: "navigator.modelContext", ctx: n };
  return { api: "none", ctx: null };
}

/** Best-effort label for the ledger. ChatGPT's built-in browser and Chrome do not identify the agent to the page; say so honestly. */
export function agentLabel(api: ModelContextApi): string {
  if (api === "none") return "none";
  const ua = (globalThis as any).navigator?.userAgent ?? "";
  if (/ChatGPT/i.test(ua)) return "chatgpt-site-tools";
  return api === "document.modelContext" ? "webmcp-agent" : "webmcp-agent (legacy navigator api)";
}
