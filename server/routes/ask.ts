import { Hono } from "hono";
import { AskError, askGroq, askRequestSchema } from "../ask/index.js";

/**
 * POST /api/ask  body: AskRequest { question, product }
 *   200 AskResponse { answer, grounded: true, mode: "llm" }
 *   400 { error: "invalid_request", issues }
 *   501 { error: "llm_not_configured" }   → the page answers deterministically client-side
 *   502 { error: "llm_failed" } · 504 { error: "llm_timeout" }
 */
export const askRoutes = new Hono();

askRoutes.post("/ask", async (c) => {
  if (!process.env.GROQ_API_KEY) return c.json({ error: "llm_not_configured" }, 501);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request", issues: ["body must be JSON"] }, 400);
  }
  const parsed = askRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) }, 400);
  }
  try {
    return c.json(await askGroq(parsed.data), 200);
  } catch (err) {
    if (err instanceof AskError) return c.json({ error: err.code, message: err.message }, err.status);
    return c.json({ error: "llm_failed", message: "Unexpected error" }, 502);
  }
});
