import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "@hono/node-server/serve-static";
import { getConnInfo } from "@hono/node-server/conninfo";
import { readFileSync, existsSync } from "node:fs";
import { extractRoutes } from "./routes/extract.js";
import { askRoutes } from "./routes/ask.js";

export const app = new Hono();

// ---- per-IP sliding-window rate limit (in memory; one process behind Caddy) ----

export const RATE_WINDOW_MS = 60_000;
export const RATE_LIMIT_EXTRACT = 60;
export const RATE_LIMIT_ASK = 30;
export const ASK_BODY_LIMIT_BYTES = 256 * 1024;
const RATE_MAX_KEYS = 10_000;

/** Caddy sets X-Real-IP from the socket; without it (dev, tests) fall back to the connection, then "?". */
export function clientIp(c: Context): string {
  const real = c.req.header("x-real-ip")?.trim();
  if (real) return real;
  try {
    return getConnInfo(c).remote.address ?? "?";
  } catch {
    return "?";
  }
}

const hits = new Map<string, number[]>();
/** Test hook: forget every window. */
export function resetRateLimits(): void {
  hits.clear();
}

function rateLimit(bucket: string, limit: number): MiddlewareHandler {
  return async (c, next) => {
    const now = Date.now();
    const key = `${bucket}|${clientIp(c)}`;
    const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return c.json({ ok: false, code: "rate_limited", error: "Too many requests; try again in a minute." }, 429);
    }
    recent.push(now);
    // Bound memory: a flood of distinct addresses resets everyone rather than growing without limit.
    if (!hits.has(key) && hits.size >= RATE_MAX_KEYS) hits.clear();
    hits.set(key, recent);
    await next();
  };
}

// ---- routes ----

// The SPA is served from this origin (dev goes through the vite proxy), so the API is same-origin by default.
app.use("/api/*", cors({ origin: process.env.PUBLIC_ORIGIN ?? "*" }));
const extractLimit = rateLimit("extract", RATE_LIMIT_EXTRACT);
app.use("/api/extract", extractLimit);
app.use("/api/extract/debug", extractLimit);
app.use("/api/ask", rateLimit("ask", RATE_LIMIT_ASK));
app.use(
  "/api/ask",
  bodyLimit({
    maxSize: ASK_BODY_LIMIT_BYTES,
    onError: (c) => c.json({ ok: false, code: "payload_too_large", error: `Request body over ${ASK_BODY_LIMIT_BYTES / 1024} KB.` }, 413),
  }),
);
app.get("/healthz", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api", extractRoutes);
app.route("/api", askRoutes);

// Static SPA (built by vite into dist/web). In dev, vite serves the SPA itself.
const webDir = "./dist/web";
if (existsSync(`${webDir}/index.html`)) {
  app.use("/assets/*", serveStatic({ root: webDir }));
  app.get("/favicon.svg", serveStatic({ root: webDir, path: "favicon.svg" }));
  // Read per request (1 KB) so a rebuild with new asset hashes is never served from a stale in-memory copy.
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/assets/")) return c.notFound();
    return c.html(readFileSync(`${webDir}/index.html`, "utf8"));
  });
}
