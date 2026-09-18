// E2E-J3 · The plan is the review. /families, real Revit (joint-hold slot).
// E2E_ROWS = 2 rows; E2E_PARAM; E2E_VALUE = the staged value (a second one is derived for the edit).
// Red break: drop the host's stale check (apps/host/src/family-actions.ts:500) → the first apply
// succeeds and the refusal text is absent.
import { expectText, journey, requireRevit, revit } from "./cdp.ts";

const SHEET = '[aria-label="Confirmation sheet"]';
const APPLY = /^apply \d+ rows?$/;
const { rows, param, value } = revit;
const edited = `${value}-2`;

await journey("J3", async (page, step) => {
  step(`open ${revit.url("/families")}`);
  await page.open(revit.url("/families"));
  await requireRevit(page);
  const baseline = (await page.readCell(rows[0]!, param))?.value;

  step(`stage ${value} in 2 cells, click plan`);
  for (const row of rows) await page.setCell(row, param, value);
  await page.click("plan");
  await page.until(() => page.has(APPLY, SHEET), "the confirmation sheet", 120_000);

  step(`type ${edited} in one staged cell, click apply`);
  await page.setCell(rows[0]!, param, edited);
  await page.click(APPLY, SHEET);
  await page.waitText("plan again", 60_000).catch(() => {});
  expectText(
    await page.text(),
    "The staged cells changed since this plan; plan again",
    "first apply is refused as stale",
  );
  const after = await page.readCell(rows[0]!, param);
  // Staged cells carry the Revit value in their facts: "You staged {current} → {value}".
  expectText(
    after?.facts ?? "",
    `You staged ${baseline || "(blank)"} →`,
    "the cell's audit value is unchanged",
  );

  step("click plan, apply (succeeds)");
  await page.click(/^(re-)?plan$/);
  await page.until(() => page.has(APPLY, SHEET), "the confirmation sheet", 120_000);
  await page.click(APPLY, SHEET);
  await page
    .until(
      async () => !(await page.readCell(rows[0]!, param))?.staged,
      "the write to land",
      180_000,
    )
    .catch(() => {});
  const applied = await page.readCell(rows[0]!, param);
  if (!applied || applied.value !== edited || applied.staged)
    throw new Error(
      `ASSERT second apply succeeds: the audit shows ${edited} unstaged, got ${JSON.stringify(applied)}`,
    );

  step("click apply again");
  await page.click(APPLY, SHEET);
  await page.waitText("already applied", 60_000).catch(() => {});
  expectText(
    await page.text(),
    /This plan already applied \(action [^)]+\); plan again/,
    "third apply is refused as spent",
  );
});
