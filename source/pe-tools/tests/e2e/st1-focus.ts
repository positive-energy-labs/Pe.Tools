// ST-1 · The focused pane revalidates: a grid that gains focus reads its schedule again.
// No-Revit host (`host.ps1`), live demo lane. The demo lane cannot change the model underneath
// (it refuses /schedules Work writes), so the read is seen where the page says it: one more
// "read schedule ran" line in the Situation log. Forty focus cycles also cross the Reading key cap
// if superseded schedule subjects retain listeners.
// Red break: base 839bc23 (no focus edge) → no new read line.
import { journey, SITUATION, WEB, type Page } from "./cdp.ts";

const reads = async (page: Page) =>
  ((await page.textOf(SITUATION)).match(/read schedule ran/g) ?? []).length;

await journey("ST1", async (page, step) => {
  step("open /schedules in the live demo lane and open the DX Fan Coil schedule");
  await page.open(`${WEB}/schedules?demo=push&live=1`);
  await page.click(/^DX Fan Coil Unit Schedule/);
  await page.until(() => page.readCell(["2"], "REFRIGERANT"), "the grid");
  step("focus the rail");
  await page.clickAt('input[placeholder="Filter schedules…"]');
  const before = await reads(page);
  if (before < 1) throw new Error("PRECONDITION: the open read is in the log");
  step("click into the grid (row 2's number cell)");
  await page.clickAt("tbody tr:nth-child(2) td:first-child");
  await page.until(async () => (await reads(page)) > before, "a new read", 20_000).catch(() => {});
  const after = await reads(page);
  if (after <= before)
    throw new Error(`ASSERT focus re-reads the grid: log has ${after} reads, was ${before}`);
  step("cross the 32-subject cap through the actual pane focus path");
  const churnStart = after;
  for (let i = 0; i < 40; i++) {
    await page.clickAt('input[placeholder="Filter schedules…"]');
    const previous = await reads(page);
    await page.clickAt("tbody tr:nth-child(2) td:first-child");
    await page.until(async () => (await reads(page)) > previous, `completed read ${i + 1}`, 20_000);
  }
  const completed = (await reads(page)) - churnStart;
  if (completed < 40) throw new Error(`ASSERT 40 distinct completed reads: log added ${completed}`);
  const text = await page.text();
  if (text.includes("Too many Pe reading subscriptions"))
    throw new Error("ASSERT focus churn stays below the Reading key cap");
  if (!(await page.readCell(["2"], "REFRIGERANT")))
    throw new Error("ASSERT the current grid remains rendered after focus churn");
});
