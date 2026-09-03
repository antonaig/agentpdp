import { Hono } from "hono";
import type { ExtractResult } from "../../shared/types.js";
import { extractProduct, publicResult, statusFor } from "../extract/index.js";

/**
 * GET /api/extract?url=&fresh=1        → ExtractResult
 * GET /api/extract/debug?url=&fresh=1  → ExtractResult + rungs[{name, ok, ms, note}]
 *
 * Status: 200 ok · 400 invalid_url · 403 ssrf_blocked · 422 no_product · 502 fetch_failed | blocked_by_site | too_large · 504 timeout
 */
export const extractRoutes = new Hono();

function readParams(c: { req: { query(name: string): string | undefined } }) {
  const url = c.req.query("url")?.trim();
  const fresh = ["1", "true", "yes"].includes((c.req.query("fresh") ?? "").toLowerCase());
  return { url, fresh };
}

const missing: ExtractResult = { ok: false, code: "invalid_url", error: "Missing ?url=" };

extractRoutes.get("/extract", async (c) => {
  const { url, fresh } = readParams(c);
  if (!url) return c.json(missing, 400);
  const result = publicResult(await extractProduct(url, { fresh }));
  return c.json(result, statusFor(result));
});

extractRoutes.get("/extract/debug", async (c) => {
  const { url, fresh } = readParams(c);
  if (!url) return c.json({ ...missing, rungs: [] }, 400);
  const result = await extractProduct(url, { fresh });
  return c.json(result, statusFor(result));
});
