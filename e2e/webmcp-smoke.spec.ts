import { test, expect } from "@playwright/test";
import { TOOL_NAMES } from "../shared/types";
import { waitForTools } from "./helpers";

// Smoke: the generated page registers the 8 tools on document.modelContext (native Chrome API, no simulation).
const PDP = process.env.E2E_PDP_URL ?? "https://www.brooklinen.com/products/luxe-core-sheet-set";

test("generated page registers the 8 site tools", async ({ page }) => {
  const u = new URL(PDP);
  await page.goto(`/p/${u.host}${u.pathname}`);
  const names = await waitForTools(page, 8, 60_000);
  expect(names.sort()).toEqual([...TOOL_NAMES].sort());
});
