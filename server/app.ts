import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync, existsSync } from "node:fs";
import { extractRoutes } from "./routes/extract.js";
import { askRoutes } from "./routes/ask.js";

export const app = new Hono();

app.use("/api/*", cors());
app.get("/healthz", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api", extractRoutes);
app.route("/api", askRoutes);

// Static SPA (built by vite into dist/web). In dev, vite serves the SPA itself.
const webDir = "./dist/web";
if (existsSync(`${webDir}/index.html`)) {
  const index = readFileSync(`${webDir}/index.html`, "utf8");
  app.use("/assets/*", serveStatic({ root: webDir }));
  app.get("/favicon.svg", serveStatic({ root: webDir, path: "favicon.svg" }));
  app.get("*", (c) => c.html(index));
}
