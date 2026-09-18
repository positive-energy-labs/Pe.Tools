// E2E-J4 · Clearing a value is a change you can apply. /families, real Revit (joint-hold slot).
// E2E_ROWS = 1 row whose E2E_PARAM is a non-empty text parameter.
// Red break: restore the old empty→unstage codec → the cleared cell shows its baseline again.
import { journey, requireRevit, revit, CTRL } from "./cdp.ts";

const SHEET = '[aria-label="Confirmation sheet"]';
const APPLY = /^apply \d+ rows?$/;
const row = revit.rows[0]!;
const { param } = revit;

await journey("J4", async (page, step) => {
  step(`open ${revit.url("/families")}`);
  await page.open(revit.url("/families"));
  await requireRevit(page);
  const baseline = (await page.readCell(row, param))?.value;
  if (!baseline)
    throw new Error(`PRECONDITION: ${row.join("/")} × ${param} must hold text to clear`);

  step("select the cell, select-all + Delete, Enter");
  await page.clickCell(row, param);
  await page.press("a", CTRL);
  await page.press("Delete");
  await page.press("Enter");
  await page
    .until(async () => (await page.readCell(row, param))?.staged, "the clear to stage", 30_000)
    .catch(() => {});
  const staged = await page.readCell(row, param);
  // data-unsaved="" is the "by you" mark; "pea" would be Pea's.
  if (!staged || staged.value !== "" || !staged.staged || staged.unsaved !== "")
    throw new Error(
      `ASSERT before plan the cell shows an empty value staged by you, not "${baseline}": got ${JSON.stringify(staged)}`,
    );

  step("click plan, apply");
  await page.click("plan");
  await page.until(() => page.has(APPLY, SHEET), "the confirmation sheet", 120_000);
  await page.click(APPLY, SHEET);
  await page
    .until(async () => !(await page.readCell(row, param))?.staged, "the write to land", 180_000)
    .catch(() => {});
  const after = await page.readCell(row, param);
  if (!after || after.value !== "" || after.staged)
    throw new Error(
      `ASSERT after apply the audit reads empty, unstaged: got ${JSON.stringify(after)}`,
    );
  const deletes = await page.count(
    '[role="grid"] button[aria-label="delete"], table button[aria-label="delete"]',
  );
  if (deletes)
    throw new Error(`ASSERT no "delete" control on any /families cell: ${deletes} found`);
});
