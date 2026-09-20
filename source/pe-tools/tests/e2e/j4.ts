// E2E-J4 · Clearing a value is a change you can apply. /families, real Revit (joint-hold slot).
// E2E_ROWS = 1 row whose E2E_PARAM is a non-empty text parameter.
// Red break: restore the old empty→unstage codec → the cleared cell shows its baseline again.
import {
  CTRL,
  expectText,
  journey,
  PLAN,
  requireRevit,
  revit,
  SITUATION,
  type Page,
} from "./cdp.ts";

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
  if (!staged || staged.value !== "" || !staged.staged)
    throw new Error(
      `ASSERT before plan the cell shows an empty value staged, not "${baseline}": got ${JSON.stringify(staged)}`,
    );
  const band = await page.bandRow(row, param);
  expectText(band?.text ?? "", /\bby you\b/, "the band row says the clear is staged by you");
  await noDelete(page, "while staged");

  step("click plan, apply");
  await page.click(PLAN, SITUATION);
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
  await noDelete(page, "after apply");
});

/** Clearing is never deleting: no visible grid or band control says delete/remove in text or aria-label. */
async function noDelete(page: Page, when: string) {
  const found = await page.read<
    string[]
  >(`[...document.querySelectorAll('table, [role="grid"], section[aria-label="proposals"]')]
    .flatMap((root) => [...root.querySelectorAll('button, [role="button"], [role="menuitem"]')])
    .filter((e) => e.getClientRects().length)
    .map((e) => [e.innerText, e.getAttribute("aria-label")].filter(Boolean).join(" | "))
    .filter((l) => /\\b(delete|remove)\\b/i.test(l))`);
  if (found.length)
    throw new Error(
      `ASSERT ${when}, no delete/remove control in the grid or band: ${JSON.stringify(found)}`,
    );
}
