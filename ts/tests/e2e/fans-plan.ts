import type { Page } from "./cdp.ts";

/** Plan through the visible control and return the popover's text once it names an outcome. */
export async function plan(page: Page) {
  await page.click(/^plan Write to Revit$/);
  return page.until(
    async () => {
      const text = await page.textOf("[data-write-popover]");
      return /planned|refused|no staged edit|nothing to write/i.test(text) ? text : null;
    },
    "the plan outcome in the Write popover",
    300_000,
  );
}
