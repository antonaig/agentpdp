import { describe, it, expect } from "vitest";
import { app } from "../app.js";

describe("app", () => {
  it("healthz", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
  it("extract requires url", async () => {
    const res = await app.request("/api/extract");
    expect(res.status).toBe(400);
  });
});
