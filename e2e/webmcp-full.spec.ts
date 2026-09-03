import { test, expect, type Page } from "@playwright/test";

// Full native WebMCP flow in Chrome with the runtime flags. Every tool call goes through document.modelContext.executeTool,
// i.e. the page's real execute handler (gate → handler → ledger). Selectors rely on data-testid attributes agreed with the UI:
//   variant-option-<Option>-<Value> · add-to-cart · pin-variant · confirm-approve · confirm-decline · site-tools-badge
//   policy-<tool>-<on|confirm|off> · ledger-row · counter-calls · counter-blocked · merchant-panel-toggle
const PDP = process.env.E2E_PDP_URL ?? "https://www.brooklinen.com/products/down-alternative-lumbar-pillow-insert";

async function tools(page: Page): Promise<string[]> {
  return page.evaluate(async () => ((await (document as any).modelContext.getTools()) as any[]).map((t) => t.name).sort());
}
async function call(page: Page, name: string, args: Record<string, unknown> = {}) {
  return page.evaluate(async ([n, a]) => {
    const mc = (document as any).modelContext;
    const t = ((await mc.getTools()) as any[]).find((x) => x.name === n);
    if (!t) return { __missing: true };
    const raw = await mc.executeTool(t, JSON.stringify(a));
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }, [name, args] as const);
}
async function openPage(page: Page) {
  const u = new URL(PDP);
  await page.goto(`/p/${u.host}${u.pathname}`);
  await page.waitForFunction(async () => { const mc = (document as any).modelContext; return mc && (await mc.getTools()).length >= 8; }, undefined, { timeout: 60_000 });
}

test.describe("generated page", () => {
  test("tools carry the right annotations", async ({ page }) => {
    await openPage(page);
    const ann = await page.evaluate(async () => Object.fromEntries(((await (document as any).modelContext.getTools()) as any[]).map((t) => [t.name, t.annotations ?? {}])));
    expect(ann.get_product.readOnlyHint).toBe(true);
    expect(ann.list_variants.readOnlyHint).toBe(true);
    expect(ann.add_to_cart.consequentialHint).toBe(true);
    expect(ann.select_variant.readOnlyHint).not.toBe(true);
  });

  test("list_variants → select_variant updates the screen and the ledger", async ({ page }) => {
    await openPage(page);
    const lv = await call(page, "list_variants", {});
    expect(lv.ok).toBe(true);
    expect(Array.isArray(lv.variants) && lv.variants.length).toBeTruthy();
    const target = lv.variants[lv.variants.length - 1];
    const sel = await call(page, "select_variant", { variant_id: target.id });
    expect(sel.ok).toBe(true);
    expect(sel.variant.id).toBe(target.id);
    const state = await call(page, "get_session_state", {});
    expect(state.session.selectedVariantId).toBe(target.id);
    await expect(page.getByTestId("ledger-row").first()).toContainText("select_variant");
  });

  test("add_to_cart under Confirm waits for the human, then returns a checkout URL", async ({ page }) => {
    await openPage(page);
    await page.getByTestId("policy-add_to_cart-confirm").click();
    const lv = await call(page, "list_variants", { available_only: true });
    const v = lv.variants[0];
    const pending = page.evaluate(async ([id]) => {
      const mc = (document as any).modelContext;
      const t = ((await mc.getTools()) as any[]).find((x) => x.name === "add_to_cart");
      const raw = await mc.executeTool(t, JSON.stringify({ variant_id: id, quantity: 1 }));
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    }, [v.id] as const);
    await page.getByTestId("confirm-approve").click({ timeout: 15_000 });
    const res = await pending;
    expect(res.ok).toBe(true);
    expect(res.checkout_url).toMatch(/^https:\/\/[^/]+\/cart\/\S+:1/);
    await expect(page.getByTestId("ledger-row").first()).toContainText("add_to_cart");
  });

  test("policy Off unregisters exactly that tool; On restores it", async ({ page }) => {
    await openPage(page);
    await page.getByTestId("policy-add_to_cart-off").click();
    await expect.poll(() => tools(page)).not.toContain("add_to_cart");
    expect((await tools(page)).length).toBe(7);
    await page.getByTestId("policy-add_to_cart-on").click();
    await expect.poll(() => tools(page)).toContain("add_to_cart");
  });

  test("a human click is visible to the agent through get_session_state", async ({ page }) => {
    await openPage(page);
    const before = await call(page, "get_session_state", {});
    const options = page.locator("[data-testid^=variant-option-]");
    if ((await options.count()) > 1) {
      await options.nth(1).click();
      const after = await call(page, "get_session_state", {});
      expect(after.session.humanActions).toBeGreaterThan(before.session.humanActions);
    } else {
      await page.getByTestId("pin-variant").click();
      const after = await call(page, "get_session_state", {});
      expect(after.session.pinned.length).toBe(1);
    }
  });
});

test.describe("generator page", () => {
  test("make_agent_ready returns the agent-ready page URL", async ({ page, baseURL }) => {
    await page.goto("/");
    await page.waitForFunction(async () => { const mc = (document as any).modelContext; return mc && (await mc.getTools()).some((t: any) => t.name === "make_agent_ready"); }, undefined, { timeout: 30_000 });
    const res = await call(page, "make_agent_ready", { url: PDP });
    expect(res.ok).toBe(true);
    const u = new URL(PDP);
    expect(res.page_url).toBe(`${baseURL}/p/${u.host}${u.pathname}`);
  });
});
