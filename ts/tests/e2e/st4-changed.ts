// ST-4 · Freshness has teeth: Revit changing the document marks /schedules "changed in Revit",
// keeps staged and Revit values as they were, refuses push in one sentence, and `r` reads again.
// No-Revit host, live demo lane; the demo owner raises Revit's `document-changed` event.
// Run in a fresh browser: a tab's sessionStorage reuses its demo owner, with the last run's mark.
import { journey, SITUATION, WEB } from "./cdp.ts";

const STALE_READ =
  "Revit changed this document after the read your staged cells rest on; read again, then apply.";
const CHIP = "changed in Revit";

await journey("ST4", async (page, step) => {
  step("open /schedules in the live demo lane and open the DX Fan Coil schedule");
  await page.open(`${WEB}/schedules?demo=push&live=1`);
  await page.click(/^DX Fan Coil Unit Schedule/);
  await page.until(() => page.readCell(["2"], "REFRIGERANT"), "the grid");

  step("stage one cell");
  await page.setCell(["2"], "REFRIGERANT", "R-454B");
  await page.waitText("1 staged");
  const staged = await page.readCell(["2"], "REFRIGERANT");
  // The pending line draws what Revit held → what is staged.
  const pending = async () => (await page.text()).split("\n").filter((line) => line.includes("→"));
  const band = await pending();
  await page.press("Escape");
  if ((await page.text()).includes(CHIP))
    throw new Error(`ASSERT no "${CHIP}" before Revit changes`);

  step("Revit changes the document (the demo owner raises document-changed)");
  const base = await page.read<string | null>(`sessionStorage.getItem("pe-demo-live:last")`);
  if (!base) throw new Error("PRECONDITION: no live demo owner in this page");
  const raised = await fetch(`${new URL(WEB).origin}${base}/document-changed`, { method: "POST" });
  if (!raised.ok) throw new Error(`PRECONDITION: document-changed refused (${raised.status})`);

  step(`the chip "${CHIP}" is drawn; staged and Revit values are unchanged (no re-read)`);
  await page.waitText(CHIP);
  const after = await page.readCell(["2"], "REFRIGERANT");
  if (JSON.stringify(after) !== JSON.stringify(staged))
    throw new Error(
      `ASSERT cell unchanged: was ${JSON.stringify(staged)}, now ${JSON.stringify(after)}`,
    );
  const bandAfter = await pending();
  if (!band.length || JSON.stringify(bandAfter) !== JSON.stringify(band))
    throw new Error(
      `ASSERT Revit → staged unchanged: was ${JSON.stringify(band)}, now ${JSON.stringify(bandAfter)}`,
    );

  step("push is refused in one sentence");
  await page.click(/^push/, SITUATION);
  await page.waitText(STALE_READ, 30_000);

  step("r reads again and the chip is gone");
  await page.press("r");
  await page.until(async () => !(await page.text()).includes(CHIP), `no "${CHIP}"`, 30_000);
});
