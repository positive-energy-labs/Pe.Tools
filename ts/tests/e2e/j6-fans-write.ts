// E2E-J6 · Fans mutation: Pea stages ESP for a fan's shared type, the human plans, Write consumes
// the stage, and a re-plan refuses with "no staged edit". Real host, real Pea, real Revit.
// Data by env: E2E_FAN (roster label, default MUAS-1), E2E_VALUE (ESP in. wg, default 1.25).
//
// Chaos moves (E2E_CHAOS, comma-separated; real gestures only):
//   leave-return  leave /fans by a link and come back through a link before Plan   (implemented)
//   switch        open another fan while the first one's sheet still loads
//   untouched     Pea edits while the page gets no input: no click until the turn settles
//   cold          close and reconnect the browser page between the Pea turn and Plan
import { expectText, journey, requirePea, requireRevit, revit, sendChat, setPea } from "./cdp.ts";
import type { Page } from "./cdp.ts";

const FAN = process.env.E2E_FAN ?? "MUAS-1";
const ESP = process.env.E2E_VALUE || "1.25";
const CHAOS = new Set((process.env.E2E_CHAOS ?? "").split(",").filter(Boolean));
const ROSTER = '[data-pane-id="sheet-roster"]';
const LEDGER = '[data-pane-id="sheet-ledger"]';
const POPOVER = "[data-write-popover]";
const PLAN_WRITE = /^plan Write to Revit$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fanRow = new RegExp(`^${esc(FAN)}(\\s|$)`);

/** The ledger's total line as drawn; the baseline the write is compared against. */
const total = (page: Page) =>
  page.read<string>(
    `(document.querySelector(${JSON.stringify(LEDGER)})?.innerText ?? "").split("\\n").find((l) => /total/i.test(l))?.trim() ?? ""`,
  );

/** Plan through the visible control and return the popover's text once it names an outcome. */
async function plan(page: Page) {
  await page.click(PLAN_WRITE);
  return page.until(
    async () => {
      const text = await page.textOf(POPOVER);
      return /planned|refused|no staged edit/i.test(text) ? text : null;
    },
    "the plan outcome in the Write popover",
    300_000,
  );
}

// Not the README's J6 (old-shape /families Work): its own id keeps the proof directories apart.
await journey("J6-fans", async (page, step) => {
  step(`open /fans, chaos=${[...CHAOS].join(",") || "none"}`);
  await page.open(revit.url("/fans"));
  await requireRevit(page, 600_000);
  await page.until(() => page.has(fanRow, ROSTER), `${FAN} on the fans roster`, 600_000);
  step(`pick ${FAN} from the roster`);
  const selected = await page.read<boolean>(
    `[...document.querySelectorAll(${JSON.stringify(`${ROSTER} [aria-selected="true"]`)})].some((e) => ${fanRow}.test(e.innerText.trim()))`,
  );
  // Pressing a selected row closes it.
  if (!selected) await page.click(fanRow, ROSTER);
  const baseline = await page.until(() => total(page), "the ledger total", 300_000);
  step(`baseline total: ${baseline}`);

  step("ask Pea to stage ESP for the fan's shared type");
  await setPea(page);
  await requirePea(page);
  await sendChat(
    page,
    `On /fans, stage External Static Pressure ${ESP} in. wg for the type that ${FAN} shares. Stage only; do not plan or write to Revit.`,
  );

  if (CHAOS.has("leave-return")) {
    step("chaos leave-return: leave /fans by a link, return by a link");
    await page.clickAt('a[href^="/"]:not([href^="/fans"])');
    await page.until(
      async () => !new URL(await page.url()).pathname.startsWith("/fans"),
      "leaving /fans",
    );
    await page.clickAt('a[href^="/fans"]');
    await page.until(() => page.has(fanRow, ROSTER), `${FAN} after returning`, 300_000);
  }

  step("open the human plan");
  expectText(await plan(page), /planned/i, "the staged ESP plans");

  step("press Write once");
  await page.click("Write to Revit", POPOVER);
  await page.until(
    async () => (await total(page)) !== "" && !(await page.has("Write to Revit", POPOVER)),
    "the write to settle",
    300_000,
  );
  step(`total after write: ${await total(page)}`);

  step("re-plan: the stage was consumed");
  expectText(await plan(page), "no staged edit", "a re-plan after Write is refused");
});
