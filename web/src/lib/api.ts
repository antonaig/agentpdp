import type { ExtractResult, AskRequest, AskResponse } from "@shared/types";

export async function fetchExtract(url: string): Promise<ExtractResult> {
  const res = await fetch(`/api/extract?url=${encodeURIComponent(url)}`);
  return (await res.json()) as ExtractResult;
}

/** Returns null when the server has no LLM configured (501); callers fall back to deterministic answers. */
export async function askServer(req: AskRequest): Promise<AskResponse | null> {
  const res = await fetch(`/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
  if (res.status === 501) return null;
  if (!res.ok) throw new Error(`ask failed: ${res.status}`);
  return (await res.json()) as AskResponse;
}

/** /p/<host>/<path> ⇄ https://<host>/<path> */
export function pagePathToUrl(pathname: string, search = ""): string | null {
  const m = pathname.match(/^\/p\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  return `https://${m[1]}${m[2] ?? "/"}${search}`;
}
export function urlToPagePath(url: string): string {
  const u = new URL(url);
  return `/p/${u.host}${u.pathname}${u.search}`;
}
