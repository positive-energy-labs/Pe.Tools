// ST-2 · A focused grid is marked, never re-read under the hands; "read again (r)" reads it.
// No-Revit host, live demo lane. The grid takes focus once, then stays focused past STALE_S
// (60 s, route/schedules/stage.ts): the age appears with one "read again (r)"; pressing r clears it.
// Red break: base 839bc23 has no "read again (r)" (and shows the age always).
import { journey, WEB } from "./cdp.ts";

const AGAIN = "read again (r)";

await journey("ST2", async (page, step) => {
  step("open /schedules in the live demo lane and open the DX Fan Coil schedule");
  await page.open(`${WEB}/schedules?demo=push&live=1`);
  await page.click(/^DX Fan Coil Unit Schedule/);
  await page.until(() => page.readCell(["2"], "REFRIGERANT"), "the grid");
  step("focus the grid (row 2's number cell) and keep it focused past 60 s");
  await page.clickAt("tbody tr:nth-child(2) td:first-child");
  if (await page.has(AGAIN)) throw new Error(`ASSERT fresh: no "${AGAIN}" on a fresh read`);
  await page.until(() => page.has(AGAIN), `"${AGAIN}" on the stale grid`, 100_000);
  const text = await page.text();
  if (!/read (a minute|\d+ \w+) ago|read \d+m ago|read 1 minute ago/.test(text))
    throw new Error("ASSERT stale: the grid says its age beside read again");
  step("press r in the focused grid");
  await page.press("r");
  await page
    .until(async () => !(await page.has(AGAIN)), "the mark to clear", 20_000)
    .catch(() => {});
  if (await page.has(AGAIN)) throw new Error(`ASSERT after r: "${AGAIN}" is gone (read again)`);
});
