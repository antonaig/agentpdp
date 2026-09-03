import { Hono } from "hono";
import type { ExtractResult } from "../../shared/types.js";

// OWNER: extraction agent. Replace the 501 stub with the real ladder (shopify → jsonld → og) behind the SSRF guard.
export const extractRoutes = new Hono();

extractRoutes.get("/extract", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ ok: false, code: "invalid_url", error: "Missing ?url=" } satisfies ExtractResult, 400);
  return c.json({ ok: false, code: "fetch_failed", error: "extractor not implemented yet" } satisfies ExtractResult, 501);
});
