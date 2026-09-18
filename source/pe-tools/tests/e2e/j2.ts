// E2E-J2 · A group accept never overwrites the person. Chat + families pane, real Revit (slot).
// E2E_ROWS = 3 rows of one group; E2E_PARAM; E2E_VALUE = Pea's value; E2E_MINE = the person's.
// Red break: remove the `contested` skip from aggregate accept → the cell shows Pea's value staged.
import { expectText, journey, pickModel, requireRevit, revit } from "./cdp.ts";

const HEAD = '[aria-label="Pea proposals"]';
const COMPOSER = 'textarea[aria-label="Message"]';
const { rows, param, value: pea } = revit;
const mine = process.env.E2E_MINE ?? "e2e-mine";
const ask = `propose ${param} = ${pea} on ${rows.map(([family, type]) => `${family} (${type})`).join(", ")}`;

await journey("J2", async (page, step) => {
  step(`open ${revit.url("/chat?plugin=families")}, click "new"`);
  await page.open(revit.url("/chat?plugin=families"));
  await page.click("new");
  await requireRevit(page);
  await pickModel(page);

  step(`type "${mine}" in ${rows[0]!.join("/")} × ${param} + Enter`);
  await page.setCell(rows[0]!, param, mine);
  await page.until(
    async () => (await page.readCell(rows[0]!, param))?.staged,
    "my value staged",
    30_000,
  );

  step(`ask Pea: "${ask}"`);
  await page.clickAt(COMPOSER);
  await page.type(ask);
  await page.press("Enter");
  await page.waitText(ask, 30_000);
  await page.until(async () => /\bREADY\b/.test(await page.text()), "turn end", 300_000);

  step("click review ▾, then accept on the group");
  await page.click(/^review [▾▴]$/, HEAD);
  await page.click(/^accept \d+$/, HEAD);
  await page
    .until(async () => /accepted \d+/.test(await page.textOf(HEAD)), "the outcome line", 30_000)
    .catch(() => {});

  const cell = await page.readCell(rows[0]!, param);
  if (!cell || cell.value !== mine || !cell.staged)
    throw new Error(
      `ASSERT the contested cell still shows ${mine} staged: got ${JSON.stringify(cell)}`,
    );
  // Row scale carries the counter-proposal in the cell's hover facts (StateCell title), not inline.
  expectText(cell.facts, `pea proposes ${pea}`, "the contested cell shows Pea's counter-proposal");
  expectText(await page.textOf(HEAD), "accepted 2 · skipped 1 (contested)", "outcome line");
});
