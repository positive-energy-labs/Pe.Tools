import { FANS_LEDGER_ESP } from "./fan-selectors.ts";
import { plan } from "./fans-plan.ts";
// E2E-J6 · Fans mutation: Pea stages ESP for a fan, the human plans, Write consumes
// the stage, and a re-plan refuses with "no staged edit". Real host, real Pea, real Revit.
// Data by env: E2E_FAN (mark, default MUAS-1), E2E_PORT (default 2), E2E_VALUE (ESP in. wg, default 1.25).
// Use an unshared ESP type for success; a shared-type target is expected to refuse (H1's claim).
//
// Chaos moves (E2E_CHAOS, comma-separated; real gestures only):
//   leave-return  leave /fans by a link and come back through a link before Plan   (implemented)
//   switch        open another fan while the first one's sheet still loads
//   untouched     Pea edits while the page gets no input: no click until the turn settles
//   cold          close and reconnect the browser page between the Pea turn and Plan
import {
  expectText,
  journey,
  requirePea,
  requireRevit,
  revit,
  sendChat,
  setPea,
} from "../../../../tests/e2e/cdp.ts";
import { fansPanes } from "../src/panes.ts";
import type { Page } from "../../../../tests/e2e/cdp.ts";
import { marks, settled } from "../../../../tests/e2e/marks.ts";
import { pickFansWriteScope } from "./fans-write-scope.ts";
import { fanRosterRow } from "./fan-roster.ts";

const FAN = process.env.E2E_FAN ?? "MUAS-1";
const PORT = Number(process.env.E2E_PORT ?? "2");
if (!Number.isInteger(PORT) || PORT < 0)
  throw new Error("PRECONDITION: E2E_PORT must be a nonnegative integer");
const ESP = process.env.E2E_VALUE || "1.25";
const CHAOS = new Set((process.env.E2E_CHAOS ?? "").split(",").filter(Boolean));
const ROSTER = `[data-pane-id="${fansPanes.roster}"]`;
const POPOVER = "[data-write-popover]";
const fanRow = fanRosterRow(FAN, PORT);

/** The resolved unit ESP as drawn; calculated required ESP need not change after an ESP write. */
const esp = (page: Page) => page.textOf(FANS_LEDGER_ESP);

// Not the README's J6 (old-shape /families Work): its own id keeps the proof directories apart.
await journey("J6-fans", async (page, step) => {
  step(`open /fans, chaos=${[...CHAOS].join(",") || "none"}`);
  await page.open(revit.url("/fans"));
  await requireRevit(page, 600_000);
  await page.until(() => page.has(fanRow, ROSTER), `${FAN} on the fans roster`, 600_000);
  const unitId = await page.evaluate(
    ({ scope, pattern }: { scope: string; pattern: string }) => {
      const rows = [...document.querySelectorAll<HTMLElement>(`${scope} [role="option"]`)].filter(
        (e) => new RegExp(pattern).test(e.innerText),
      );
      return rows.length === 1 ? (rows[0]?.getAttribute("data-revit-ids") ?? null) : null;
    },
    { scope: ROSTER, pattern: fanRow.source },
  );
  step(`pick ${FAN} port ${PORT} from the roster`);
  const selected = await page.read<boolean>(
    `[...document.querySelectorAll(${JSON.stringify(`${ROSTER} [aria-selected="true"]`)})].some((e) => ${fanRow}.test(e.innerText.trim()))`,
  );
  // Pressing a selected row closes it.
  if (!selected) await page.click(fanRow, ROSTER);
  const baseline = await page.until(() => esp(page), "the ledger unit ESP", 300_000);
  step(`baseline unit ESP: ${baseline}`);

  step(`ask Pea to stage ESP for ${FAN} port ${PORT}`);
  await setPea(page);
  await requirePea(page);
  await sendChat(
    page,
    `On /fans, stage External Static Pressure ${ESP} in. wg for ${FAN}, port ${PORT}. Stage only; do not plan or write to Revit.`,
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

  await page.until(async () => settled(await marks(page)), "fans settled before scope", 300_000);
  await pickFansWriteScope(
    FAN,
    (scope, pattern) => page.click(new RegExp(pattern), scope),
    (scope, pattern) => page.until(() => page.has(new RegExp(pattern), scope), "the Write scope"),
    unitId,
  );
  await page.until(async () => settled(await marks(page)), "fans settled before plan", 300_000);
  step("open the human plan");
  expectText(await plan(page), /planned/i, "the staged ESP plans");

  step("press Write once");
  await page.click("Write to Revit", POPOVER);
  await page.until(
    async () =>
      (await esp(page)) === Number(ESP).toFixed(4) &&
      (await esp(page)) !== baseline &&
      !(await page.has("Write to Revit", POPOVER)),
    "the write to settle",
    300_000,
  );
  step(`unit ESP after write: ${await esp(page)}`);

  step("re-plan: the stage was consumed");
  expectText(await plan(page), /nothing to write/i, "a re-plan after Write is refused");
});
