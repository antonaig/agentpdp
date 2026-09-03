import { Hono } from "hono";

// OWNER: extraction agent. Implements grounded Q&A: Groq (OpenAI-compatible chat completions) when GROQ_API_KEY is set,
// otherwise 501 so the page falls back to deterministic answers client-side.
export const askRoutes = new Hono();

askRoutes.post("/ask", async (c) => {
  if (!process.env.GROQ_API_KEY) return c.json({ error: "llm_not_configured" }, 501);
  return c.json({ error: "not implemented" }, 501);
});
