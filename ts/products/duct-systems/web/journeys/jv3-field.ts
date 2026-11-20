// J-V3: one row, drawing pricing's value AND source (MAP V3).
// Fixture writer command (from ts): node --import jiti/register tests/journey-fixtures/jv3-field-host.ts
// Real target: JV3_PRICING_FILE=<captured host pricing JSON> E2E_WEB=<bound /duct-systems URL>
// CDP_PORT/CDP_TARGET=<owned browser> node --import jiti/register products/duct-systems/web/journeys/jv3-field.ts --seed 20261118
// This script never launches or contacts Revit itself. The driver owns the prepared target.
// Fixture mode proves linkage only, never J-V3 acceptance.
import { assertPageBinding } from "../../../../tests/e2e/page-binding.ts";
import { readFileSync } from "node:fs";
import { criterionCellLabel } from "@pe/ducts-contract/settings";
import { run, type Action, type Rule } from "../../../../tests/e2e/walk.ts";
import { WEB, type Page } from "../../../../tests/e2e/cdp.ts";

if (!process.env.JV3_PRICING_FILE)
  throw Error("PRECONDITION: JV3_PRICING_FILE must capture the host pricing read");
if (!process.env.E2E_WEB || new URL(WEB).pathname !== "/duct-systems" || !process.env.CDP_TARGET)
  throw Error("PRECONDITION: supply an explicit /duct-systems URL and an owned CDP target");
const evidence = JSON.parse(readFileSync(process.env.JV3_PRICING_FILE, "utf8"));
const priced = evidence.read.criteria.autoJoinGapIn;
if (
  priced.value !== 9 ||
  priced.source.toLowerCase() !== "work" ||
  evidence.work.criteria.autoJoinGapIn.edit.value !== 9 ||
  !evidence.read.settings.ducts.some(
    (t: { tier: string; json: { criteria: { autoJoinGapIn: number } } }) =>
      t.tier === "firm" && t.json.criteria.autoJoinGapIn === 5,
  )
)
  throw Error("PRECONDITION: host evidence must contain firm 5, staged Work 9, pricing 9 Work");
const label = criterionCellLabel("autoJoinGapIn");
const rows = (page: Page) =>
  page.evaluate(
    (label: string) =>
      [...document.querySelectorAll<HTMLElement>("[data-sheet-cell]")]
        .filter(
          (e) =>
            e.dataset.sheetCell === label &&
            [...e.querySelectorAll("*")].some((child) => child.getClientRects().length > 0),
        )
        .map((e) => {
          const control = e.querySelector("[data-cell-owner]");
          const displayed = Array.from(control?.childNodes ?? []).find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          );
          return {
            address: e.dataset.sheetAddress ?? null,
            source: e.dataset.source ?? null,
            text: e.textContent?.trim() ?? null,
            value: control?.querySelector("input")?.value ?? displayed?.textContent?.trim() ?? null,
          };
        }),
    label,
  );
const actions: Action[] = [
  {
    name: "open",
    can: async () => true,
    async act({ page }) {
      await page.open(WEB);
      return async () => {
        if (!(await rows(page)).length) return false;
        await assertPageBinding(page);
        return true;
      };
    },
    ms: 90_000,
  },
];
const rules: Rule[] = [
  {
    says: "The criterion occurs once and draws pricing's value and source word.",
    async holds({ page }) {
      const drawn = await rows(page);
      console.log(JSON.stringify({ priced, drawn }));
      const row = drawn[0];
      return drawn.length === 1 &&
        Number(row.value) === priced.value &&
        row.source?.toLowerCase() === priced.source.toLowerCase() &&
        /\bwork\b/i.test(row.text ?? "")
        ? true
        : JSON.stringify({ priced, drawn });
    },
  },
];
await run(
  process.env.E2E_LINKAGE_MODE === "fixture-linkage" ? "J-V3-fixture-linkage" : "J-V3",
  actions,
  rules,
  ["open"],
  (url) => url.startsWith(new URL(WEB).origin),
);
