import { test, expect } from "@playwright/test";
import { TOOL_NAMES } from "../shared/types";

// Smoke: the generated page registers the 8 tools on document.modelContext (native Chrome API, no simulation).
const PDP = process.env.E2E_PDP_URL ?? "https://www.brooklinen.com/products/down-alternative-lumbar-pillow-insert";

test("generated page registers the 8 site tools", async ({ page }) => {
  const u = new URL(PDP);
  await page.goto(`/p/${u.host}${u.pathname}`);
  await page.waitForFunction(async () => {
    const mc = (document as any).modelContext;
    return mc && (await mc.getTools()).length >= 8;
  }, undefined, { timeout: 60_000 });
  const names = await page.evaluate(async () => ((await (document as any).modelContext.getTools()) as any[]).map((t) => t.name).sort());
  expect(names).toEqual([...TOOL_NAMES].sort());
});
