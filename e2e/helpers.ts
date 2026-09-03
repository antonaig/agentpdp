import type { Page } from "@playwright/test";

/**
 * Poll document.modelContext.getTools() until at least `min` tools (optionally one named `mustInclude`) are registered.
 * Note: page.waitForFunction with an async predicate resolves immediately on the Promise object, so we poll explicitly.
 */
export async function waitForTools(page: Page, min: number, timeoutMs: number, mustInclude?: string): Promise<string[]> {
  const started = Date.now();
  let names: string[] = [];
  while (Date.now() - started < timeoutMs) {
    names = await page.evaluate(async () => {
      const mc = (document as any).modelContext;
      if (!mc) return [] as string[];
      return ((await mc.getTools()) as any[]).map((t) => t.name as string);
    });
    if (names.length >= min && (!mustInclude || names.includes(mustInclude))) return names;
    await page.waitForTimeout(400);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${min} tools${mustInclude ? ` incl. ${mustInclude}` : ""}; have: ${JSON.stringify(names)}`);
}
