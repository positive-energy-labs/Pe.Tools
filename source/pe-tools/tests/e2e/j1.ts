// E2E-J1 · Pea's bulk proposal reaches Revit through the person. Chat + families pane, real
// Revit (joint-hold slot). E2E_ROWS = 3 [family, type] rows; E2E_PARAM/E2E_VALUE the change.
// Red break: revert the plan-plugin wiring so `plan` navigates to /families → (d) fails.
import { expectText, journey, pickModel, requireRevit, revit } from "./cdp.ts";

const HEAD = '[aria-label="Pea proposals"]';
const SHEET = '[aria-label="Confirmation sheet"]';
const COMPOSER = 'textarea[aria-label="Message"]';
const { rows, param, value } = revit;
const n = rows.length;
const ask = `set ${param} to ${value} on ${rows.map(([family, type]) => `${family} (${type})`).join(", ")}`;

await journey("J1", async (page, step) => {
  step(`open ${revit.url("/chat?plugin=families")}, click "new"`);
  await page.open(revit.url("/chat?plugin=families"));
  await page.click("new");
  await requireRevit(page);
  await pickModel(page);

  step(`type "${ask}" + Enter; wait for the turn to end`);
  await page.clickAt(COMPOSER);
  await page.type(ask);
  await page.press("Enter");
  await page.waitText(ask, 30_000);
  // Timing gate: the turn is over when the status line returns to READY.
  await page.until(async () => /\bREADY\b/.test(await page.text()), "turn end", 300_000);

  step("(a) transcript: the proposal record, and no accept/deny outside the head");
  expectText(await page.text(), `Pea proposed ${n} changes in Families`, "(a) transcript record");
  const strayVerbs = await page.read<number>(`[...document.querySelectorAll("button")]
    .filter((b) => b.getClientRects().length && /^(accept|deny)\\b/.test(b.innerText.trim()) && !b.closest(${JSON.stringify(HEAD)}))
    .length`);
  if (strayVerbs)
    throw new Error(`ASSERT (a) no accept/deny in the transcript: ${strayVerbs} found`);

  step("click the Chat head's review ▾");
  await page.click(/^review [▾▴]$/, HEAD);
  const head = await page.textOf(HEAD);
  expectText(head, `→ ${value}`, "(b) group row shows the value");
  expectText(head, `${n} cells`, "(b) group row shows the cell count");

  step(`click accept ${n}`);
  await page.click(`accept ${n}`, HEAD);
  await page
    .until(async () => (await page.textOf(HEAD)).includes(`${n} staged`), "staged count", 30_000)
    .catch(() => {});
  expectText(await page.textOf(HEAD), `${n} staged`, "(c) head reads n staged");

  step("click plan r{rev} in the Chat head");
  await page.click(/^plan r\d+$/, HEAD);
  await page.until(() => page.has(/^apply \d+ rows?$/, SHEET), "the confirmation sheet", 120_000);
  const url = new URL(await page.url());
  if (url.pathname !== "/chat" || url.searchParams.get("plugin") !== "families")
    throw new Error(
      `ASSERT (d) the sheet opens in the Chat pane: URL is ${url.pathname}${url.search}`,
    );
  expectText(await page.text(), ask, "(d) the transcript is still in the DOM beside the sheet");

  step("click apply in the confirmation sheet");
  await page.click(/^apply \d+ rows?$/, SHEET);
  // Timing gate: the head line retires once Revit took the write; the cells are the assertion.
  await page
    .until(
      async () => !(await page.textOf(HEAD)).includes("families"),
      "the head line to retire",
      180_000,
    )
    .catch(() => {});
  for (const row of rows) {
    const cell = await page.readCell(row, param);
    if (!cell || cell.value !== value || cell.staged)
      throw new Error(
        `ASSERT (e) ${row.join("/")} × ${param} reads ${value} from Revit, unstaged: got ${JSON.stringify(cell)}`,
      );
  }
  expectText(await page.textOf(HEAD), "families", "(e) the Families head line is gone", false);
});
