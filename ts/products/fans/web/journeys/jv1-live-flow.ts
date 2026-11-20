import { plan } from "./fans-plan.ts";
// Real-Revit target (operator-assisted, never launches Revit):
// node --import jiti/register products/fans/web/journeys/jv1-live-flow.ts
// E2E_WEB, CDP_PORT, CDP_TARGET, E2E_TARGET, E2E_SESSION, E2E_FAN, E2E_PORT,
// E2E_TERMINAL (UniqueId SubjectRef). Use a disposable controlled Chadds copy.
// Before starting, write terminal 200 cfm through /fans and retain its receipt.
// Each prompt takes a path to an independent native read JSON, never a route receipt:
// {session, openId, terminal, fan, port, parameter, flowCfm, receiptCfm, requiredEspInWg, readAt}.
// The driver performs the hand edit and native reads outside this script.
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { journey, revit, requireRevit } from "../../../../tests/e2e/cdp.ts";
import { assertPageBinding, documentTarget } from "../../../../tests/e2e/page-binding.ts";
import { fanRosterRow } from "./fan-roster.ts";
import { pickFansWriteScope } from "./fans-write-scope.ts";
import { marks, settled } from "../../../../tests/e2e/marks.ts";

const terminal = process.env.E2E_TERMINAL;
const fan = process.env.E2E_FAN;
const port = Number(process.env.E2E_PORT);
if (!terminal || !fan || !Number.isInteger(port) || !process.env.E2E_SESSION || !revit.target)
  throw Error(
    "PRECONDITION: explicit disposable document, session, fan, port and terminal required",
  );
const target = documentTarget(revit.target, process.env.E2E_SESSION);
if (!process.env.E2E_ESP_PARAMETER) throw Error("PRECONDITION: E2E_ESP_PARAMETER required");
const row = `[data-sheet-address=${JSON.stringify(`flows:${terminal}`)}]`;
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  await journey("J-V1", async (page, step, dir) => {
    const native = async (phase: string, since: number) => {
      const file = await rl.question(`${phase}. Path to independent native read JSON: `);
      const value = JSON.parse(readFileSync(file.trim(), "utf8"));
      assert.equal(value.session, process.env.E2E_SESSION);
      assert.equal(value.terminal, terminal);
      assert.equal(value.openId, target.openId);
      assert.equal(value.fan, fan);
      assert.equal(value.port, port);
      assert.equal(value.parameter, process.env.E2E_ESP_PARAMETER);
      assert.ok(Number.isFinite(value.requiredEspInWg));
      assert.ok(Date.parse(value.readAt) >= since, "native read must follow this phase");
      writeFileSync(join(dir, `${phase}.json`), JSON.stringify(value, null, 2));
      return value;
    };
    await page.open(revit.url("/fans"));
    await requireRevit(page);
    const label = fanRosterRow(fan, port);
    const roster = '[role="listbox"][aria-label="fans"]';
    await page.until(() => page.has(label, roster), "the named fan");
    const unitId = await page.evaluate(
      ({ scope, pattern }: { scope: string; pattern: string }) => {
        const rows = [...document.querySelectorAll<HTMLElement>(`${scope} [role="option"]`)].filter(
          (e) => new RegExp(pattern).test(e.innerText),
        );
        return rows.length === 1 ? (rows[0]?.getAttribute("data-revit-ids") ?? null) : null;
      },
      { scope: roster, pattern: label.source },
    );
    if (
      !(await page.evaluate(
        ({ scope, pattern }: { scope: string; pattern: string }) =>
          [...document.querySelectorAll<HTMLElement>(`${scope} [aria-selected="true"]`)].some((e) =>
            new RegExp(pattern).test(e.innerText),
          ),
        { scope: roster, pattern: label.source },
      ))
    ) {
      await assertPageBinding(page);
      await page.click(label, roster);
    }
    await page.until(async () => settled(await marks(page)), "settled receipt baseline");
    const before = await native("baseline-after-200-cfm-receipt", 0);
    assert.equal(before.flowCfm, 200);
    assert.equal(before.receiptCfm, 200);
    const required = () =>
      page.textOf('[aria-label="Required ESP"] > div:first-of-type > span:nth-child(2)');
    const baselineEsp = parseFloat(await required());
    assert.ok(
      Number.isFinite(baselineEsp) && baselineEsp > 0,
      "complete numeric ESP baseline required",
    );
    const editAt = Date.now();
    const edited = await native("hand-edit-terminal-to-400-cfm-in-Revit", editAt);
    assert.equal(edited.flowCfm, 400);
    assert.equal(edited.receiptCfm, 200);
    // Explicit next read. Capture the first failure before any further recovery.
    await page.reload();
    await page.until(async () => settled(await marks(page)), "settled next read");
    await page.dump(dir, "first-read-after-hand-edit");
    const flow = await page.evaluate(
      (selector: string) =>
        document.querySelector<HTMLInputElement>(`${selector} input`)?.value ?? null,
      row,
    );
    assert.equal(
      Number(flow),
      400,
      "J-V1 stale store flow: live 400 cfm must beat receipt 200 cfm",
    );
    assert.notEqual(
      await page.evaluate(
        (selector: string) => document.querySelector(selector)?.getAttribute("data-source") ?? null,
        row,
      ),
      "model-store",
    );
    // The real page marks drift with data-drift and puts the note in the cell's aria-description (the hover
    // tooltip repeats it), never as inline text (45c670d4 c2-jv1-drift-tooltip). The note is exact; only the
    // source tail "model model:<element id>/revit:Flow" carries an id this script is never given.
    assert.equal(
      await page.evaluate(
        (selector: string) => document.querySelector(selector)?.getAttribute("data-drift") ?? null,
        row,
      ),
      "true",
      "terminal must flag receipt drift",
    );
    const described = await page.evaluate(
      (selector: string) =>
        document
          .querySelector(`${selector} [aria-description]`)
          ?.getAttribute("aria-description") ?? null,
      row,
    );
    assert.match(
      described ?? "",
      /^Changed in Revit since Pe wrote 200 cfm · model model:\d+\/revit:Flow$/,
      "terminal must show receipt drift note",
    );
    const expectedEsp = parseFloat(await required());
    assert.ok(expectedEsp > baselineEsp, "computed ESP must rise with the edited flow");
    await assertPageBinding(page);
    await pickFansWriteScope(
      fan,
      async (scope, pattern) => {
        await assertPageBinding(page);
        await page.click(new RegExp(pattern), scope);
      },
      (scope, pattern) => page.until(() => page.has(new RegExp(pattern), scope), "write scope"),
      unitId,
    );
    await page.until(async () => settled(await marks(page)), "settled write scope");
    await assertPageBinding(page);
    await plan(page);
    const popover = "[data-write-popover]";
    await page.until(() => page.has("Write to Revit", popover), "reviewable plan");
    await page.dump(dir, "reviewed-plan");
    const writeAt = Date.now();
    await assertPageBinding(page);
    await page.click("Write to Revit", popover);
    await page.until(
      async () => settled(await marks(page)) && !(await page.has("Write to Revit", popover)),
      "write receipt",
    );
    const after = await native("independent-read-after-apply", writeAt);
    assert.equal(after.flowCfm, 400, "apply must preserve the hand edit");
    assert.ok(
      Math.abs(after.requiredEspInWg - expectedEsp) <= 0.0001,
      "native ESP must equal the newly computed displayed ESP",
    );
    step(`native ESP ${after.requiredEspInWg}, displayed ${expectedEsp}, baseline ${baselineEsp}`);
    await assertPageBinding(page);
    await plan(page);
    await page.until(
      () => page.has(/nothing to write|no staged edit/i, popover),
      "consumed work refuses re-plan",
    );
  });
} finally {
  rl.close();
}
