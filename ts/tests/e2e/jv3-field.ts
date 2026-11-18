// J-V3: one row, drawing pricing's value AND source (MAP V3).
// Fixture writer command (from ts): node --import jiti/register tests/e2e/jv3-field-host.ts
// Real target: JV3_PRICING_FILE=<captured host pricing JSON> E2E_WEB=<bound /duct-systems URL>
// CDP_PORT/CDP_TARGET=<owned browser> node --import jiti/register tests/e2e/jv3-field.ts --seed 20261118
// This script never launches or contacts Revit itself. The driver owns the prepared target.
import { readFileSync } from "node:fs";
import { criterionCellLabel } from "@pe/agent-contracts/setting-owners";
import { run, type Action, type Rule } from "./walk.ts";
import { WEB, type Page } from "./cdp.ts";

if (!process.env.JV3_PRICING_FILE) throw Error("PRECONDITION: JV3_PRICING_FILE must capture the host pricing read");
if (!process.env.E2E_WEB || new URL(WEB).pathname !== "/duct-systems" || !process.env.CDP_TARGET)
  throw Error("PRECONDITION: supply an explicit /duct-systems URL and an owned CDP target");
const evidence = JSON.parse(readFileSync(process.env.JV3_PRICING_FILE, "utf8"));
const priced = evidence.read.criteria.autoJoinGapIn;
if (priced.value !== 9 || priced.source.toLowerCase() !== "work" ||
    evidence.work.criteria.autoJoinGapIn.edit.value !== 9 ||
    !evidence.read.settings.ducts.some((t: any) => t.tier === "firm" && t.json.criteria.autoJoinGapIn === 5))
  throw Error("PRECONDITION: host evidence must contain firm 5, staged Work 9, pricing 9 Work");
const label = criterionCellLabel("autoJoinGapIn");
const rows = (page: Page) => page.evaluate((label: string) =>
  [...document.querySelectorAll<HTMLElement>("[data-sheet-cell]")]
    .filter(e => e.dataset.sheetCell === label && e.getClientRects().length > 0)
    .map(e => ({ address: e.dataset.sheetAddress, source: e.dataset.source,
      text: e.textContent?.trim(), value: e.querySelector<HTMLInputElement>("input")?.value })), label);
const actions: Action[] = [{ name: "open", can: async () => true, async act({ page }) {
  await page.open(WEB);
  return async () => (await rows(page)).length > 0;
}, ms: 90_000 }];
const rules: Rule[] = [{ says: "The criterion occurs once and draws pricing's value and source word.", async holds({ page }) {
  const drawn = await rows(page);
  console.log(JSON.stringify({ priced, drawn }));
  const row = drawn[0];
  return drawn.length === 1 && Number(row.value) === priced.value &&
    row.source?.toLowerCase() === priced.source.toLowerCase() && /\bwork\b/i.test(row.text ?? "")
    ? true : JSON.stringify({ priced, drawn });
} }];
await run("J-V3", actions, rules, ["open"], url => url.startsWith(new URL(WEB).origin));
