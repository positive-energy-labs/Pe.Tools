// ST-1 · The focused pane revalidates: a stale grid that gains focus reads its schedule again.
// No-Revit host (`host.ps1`), live demo lane. The demo lane cannot change the model underneath
// (it refuses /schedules Work writes), so the read is seen where the page says it: one more
// "read schedule ran" line in the Situation log. The grid's policy is { maxAgeS: STALE_S = 60 }.
// Red break: base 839bc23 (no focus edge) → no new read line.
import { journey, SITUATION, WEB, type Page } from "./cdp.ts";

const reads = async (page: Page) =>
  ((await page.textOf(SITUATION)).match(/read schedule ran/g) ?? []).length;

await journey("ST1", async (page, step) => {
  step("open /schedules in the live demo lane and open the DX Fan Coil schedule");
  await page.open(`${WEB}/schedules?demo=push&live=1`);
  await page.click(/^DX Fan Coil Unit Schedule/);
  await page.until(() => page.readCell(["2"], "REFRIGERANT"), "the grid");
  step("focus the rail and wait past 60 s");
  await page.clickAt('input[placeholder="Filter schedules…"]');
  await new Promise((r) => setTimeout(r, 65_000));
  const before = await reads(page);
  if (before < 1) throw new Error("PRECONDITION: the open read is in the log");
  step("click into the grid (row 2's number cell)");
  await page.clickAt("tbody tr:nth-child(2) td:first-child");
  await page.until(async () => (await reads(page)) > before, "a new read", 20_000).catch(() => {});
  const after = await reads(page);
  if (after <= before)
    throw new Error(`ASSERT focus re-reads a stale grid: log has ${after} reads, was ${before}`);
});
