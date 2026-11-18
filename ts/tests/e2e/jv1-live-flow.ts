// Real-Revit target (operator-assisted, never launches Revit):
// node --import jiti/register tests/e2e/jv1-live-flow.ts
// E2E_WEB, CDP_PORT, CDP_TARGET, E2E_TARGET, E2E_SESSION, E2E_FAN, E2E_PORT,
// E2E_TERMINAL (UniqueId SubjectRef). Use a disposable controlled Chadds copy.
// Before starting, write terminal 200 cfm through /fans and retain its receipt.
// Each prompt takes a path to an independent native read JSON, never a route receipt:
// {session, openId, terminal, flowCfm, receiptCfm, requiredEspInWg, readAt}.
// The driver performs the hand edit and native reads outside this script.
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { journey, revit, requireRevit } from "./cdp.ts";
import { fanRosterRow } from "./fan-roster.ts";
import { pickFansWriteScope } from "./fans-write-scope.ts";
import { marks, settled } from "./marks.ts";

const terminal = process.env.E2E_TERMINAL;
const fan = process.env.E2E_FAN;
const port = Number(process.env.E2E_PORT);
if (!terminal || !fan || !Number.isInteger(port) || !process.env.E2E_SESSION || !revit.target)
  throw Error("PRECONDITION: explicit disposable document, session, fan, port and terminal required");
const row = `[data-sheet-address=${JSON.stringify(`flows:${terminal}`)}]`;
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  await journey("J-V1", async (page, step, dir) => {
    const native = async (phase: string, since: number) => {
      const file = await rl.question(`${phase}. Path to independent native read JSON: `);
      const value = JSON.parse(readFileSync(file.trim(), "utf8"));
      assert.equal(value.session, process.env.E2E_SESSION);
      assert.equal(value.terminal, terminal);
      const target = JSON.parse(revit.target);
      assert.equal(value.openId, target.ref?.openId ?? target.openId);
      assert.ok(Date.parse(value.readAt) >= since, "native read must follow this phase");
      writeFileSync(join(dir, `${phase}.json`), JSON.stringify(value, null, 2));
      return value;
    };
    await page.open(revit.url("/fans"));
    await requireRevit(page);
    const label = fanRosterRow(fan, port);
    const roster = '[role="listbox"][aria-label="fans"]';
    await page.until(() => page.has(label, roster), "the named fan");
    if (!(await page.evaluate(({ scope, pattern }: { scope: string; pattern: string }) =>
      [...document.querySelectorAll(`${scope} [aria-selected="true"]`)].some(e => new RegExp(pattern).test((e as HTMLElement).innerText)),
      { scope: roster, pattern: label.source })))
      await page.click(label, roster);
    await page.until(async () => settled(await marks(page)), "settled receipt baseline");
    const before = await native("baseline-after-200-cfm-receipt", 0);
    assert.equal(before.flowCfm, 200);
    assert.equal(before.receiptCfm, 200);
    const required = () => page.textOf('[aria-label="Required ESP"] > div:first-of-type > span:nth-child(2)');
    const baselineEsp = parseFloat(await required());
    assert.ok(Number.isFinite(baselineEsp) && baselineEsp > 0, "complete numeric ESP baseline required");
    const editAt = Date.now();
    const edited = await native("hand-edit-terminal-to-400-cfm-in-Revit", editAt);
    assert.equal(edited.flowCfm, 400);
    assert.equal(edited.receiptCfm, 200);
    // Explicit next read. Capture the first failure before any further recovery.
    await page.reload();
    await page.until(async () => settled(await marks(page)), "settled next read");
    await page.dump(dir, "first-read-after-hand-edit");
    const flow = await page.evaluate((selector: string) => (document.querySelector(`${selector} input`) as HTMLInputElement | null)?.value, row);
    assert.equal(Number(flow), 400, "J-V1 stale store flow: live 400 cfm must beat receipt 200 cfm");
    assert.notEqual(await page.evaluate((selector: string) => document.querySelector(selector)?.getAttribute("data-source"), row), "model-store");
    assert.equal(await page.evaluate((selector: string) => document.querySelector(selector)?.getAttribute("data-drift"), row), "true", "terminal must show drift");
    const expectedEsp = parseFloat(await required());
    assert.ok(expectedEsp > baselineEsp, "computed ESP must rise with the edited flow");
    await pickFansWriteScope(fan, (scope, pattern) => page.click(new RegExp(pattern), scope),
      (scope, pattern) => page.until(() => page.has(new RegExp(pattern), scope), "write scope"));
    await page.until(async () => settled(await marks(page)), "settled write scope");
    await page.click(/^plan Write to Revit$/);
    const popover = "[data-write-popover]";
    await page.until(() => page.has("Write to Revit", popover), "reviewable plan");
    await page.dump(dir, "reviewed-plan");
    const writeAt = Date.now();
    await page.click("Write to Revit", popover);
    await page.until(async () => settled(await marks(page)) && !(await page.has("Write to Revit", popover)), "write receipt");
    const after = await native("independent-read-after-apply", writeAt);
    assert.equal(after.flowCfm, 400, "apply must preserve the hand edit");
    assert.ok(Math.abs(after.requiredEspInWg - expectedEsp) <= 0.0001, "native ESP must equal the newly computed displayed ESP");
    step(`native ESP ${after.requiredEspInWg}, displayed ${expectedEsp}, baseline ${baselineEsp}`);
    await page.click(/^plan Write to Revit$/);
    await page.until(() => page.has(/nothing to write|no staged edit/i, popover), "consumed work refuses re-plan");
  });
} finally { rl.close(); }
