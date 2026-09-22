// SIG-REFUSAL · One refusal, on the refused cell, plus one log line. /schedules, real Revit (slot).
// E2E_TARGET; E2E_SCHEDULE = a schedule name in the rail; E2E_ROWS = [[row words]]; E2E_PARAM = a
// measurable column; E2E_VALUE = a bare number the host refuses ("300" on Flow Rate Min, user image 2).
// Red: 9683205 draws the refusal in a popover, a banner and a strip, and never on the cell.
import { journey, requireRevit, revit, SITUATION } from "./cdp.ts";

const schedule = process.env.E2E_SCHEDULE ?? "";
const { rows, param, value } = revit;

await journey("SIG-REFUSAL", async (page, step) => {
  if (!schedule || !rows[0] || !param || !value)
    throw new Error("PRECONDITION: E2E_SCHEDULE, E2E_ROWS, E2E_PARAM and E2E_VALUE");
  step(`open ${revit.url("/schedules")}`);
  await page.open(revit.url("/schedules"));
  await requireRevit(page);

  step(`pick ${schedule}, stage ${value} in ${rows[0].join("/")} × ${param}, click push`);
  await page.click(schedule);
  await page.setCell(rows[0], param, value);
  await page.until(async () => (await page.readCell(rows[0]!, param))?.staged, "the cell staged");
  await page.click(/^push\b/, SITUATION);
  await page.until(
    async () => /\brefused\b/.test(await page.text()),
    "the push to settle",
    120_000,
  );

  const cell = await page.read<string>(`(() => {
    const th = [...document.querySelectorAll("thead th")].find((th) => th.innerText.trim().split(/\\s*\\n/)[0].toLowerCase() === ${JSON.stringify(param.toLowerCase())});
    const tr = [...th.closest("table").querySelectorAll("tbody tr")].find((tr) => ${JSON.stringify(rows[0])}.every((w) => tr.innerText.toLowerCase().includes(w.toLowerCase())));
    const x = th.getBoundingClientRect().left + th.getBoundingClientRect().width / 2;
    const td = [...tr.children].find((td) => { const r = td.getBoundingClientRect(); return r.left <= x && x <= r.right; });
    return [td.innerText, ...[...td.querySelectorAll("[title]")].map((e) => e.title)].join(" | ");
  })()`);
  step(`refused cell draws: ${cell}`);
  if (!/refus|bare numeric/i.test(cell))
    throw new Error(`ASSERT the refused cell draws its refusal: got "${cell}"`);

  const text = await page.text();
  const logLines = text.split("\n").filter((l) => /\bpush\b.*\brefused\b/i.test(l));
  step(`log lines: ${JSON.stringify(logLines)}`);
  if (logLines.length !== 1)
    throw new Error(`ASSERT one log line for the refusal: got ${logLines.length}`);
  for (const re of [/nothing ran/i, /push run ·/i, /Bare numeric value/])
    if (re.test(text) && !cell.includes(text.match(re)![0]))
      throw new Error(`ASSERT no second copy of the refusal outside its cell: found ${re}`);
});
