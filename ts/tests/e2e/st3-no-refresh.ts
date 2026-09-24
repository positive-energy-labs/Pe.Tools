// ST-3 · Focus is the refresh: /schedules draws no refresh controls and no read verb button.
// No-Revit host, live demo lane. Red break: base 839bc23 draws re-list, re-read and read schedule.
import { journey, SITUATION, WEB } from "./cdp.ts";

await journey("ST3", async (page, step) => {
  step("open /schedules in the live demo lane and open the DX Fan Coil schedule");
  await page.open(`${WEB}/schedules?demo=capture&live=1`);
  await page.click(/^DX Fan Coil Unit Schedule/);
  await page.until(() => page.readCell(["2"], "REFRIGERANT"), "the grid");
  for (const name of ["re-list", "list schedules", "re-read"])
    if (await page.has(name)) throw new Error(`ASSERT no refresh control: "${name}" is drawn`);
  for (const name of [/^read schedule/, /^list schedules/])
    if (await page.has(name, SITUATION))
      throw new Error(`ASSERT a read is not a verb button: ${name} is on the verb row`);
  if (!(await page.has(/^push/, SITUATION)))
    throw new Error("ASSERT the verb row still draws the stage verb push");
});
