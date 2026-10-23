/** Source census only: cannot detect unclassed prose, aliases, or prove dock/tooltip layout. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/src");
const files = (dir: string, prefix = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${prefix}${entry.name}`;
    return entry.isDirectory()
      ? files(join(dir, entry.name), `${rel}/`)
      : /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel)
        ? [rel]
        : [];
  });

// Each exception was read on 2026-10-23. Status/refusal evidence must remain available at the decision.
const ALLOW: Record<string, string> = {
  "routes/duct-loss.tsx":
    "Seven hits are input labels, measured outputs, headings and equations; none is a sentence.",
  "duct/charts.tsx": "Chart titles and equations label the plotted law, not tutorial prose.",
  "components/work/band.tsx":
    "Discard receipts and unresolved write conflicts explain recovery; the third hit is the staged/proposed tally.",
  "route/situation-verbs.tsx":
    "Operation outcomes and expanded action explanations/refusals are explicit disclosures needed before a write.",
  "route/situation-grids.tsx":
    "The two hits are ledger values and log labels; explanations already live in TooltipHint.",
  "route/schedules/stale-resolve.tsx":
    "A failed readback needs a recovery explanation before overwrite; the second hit groups confirmation buttons.",
  "workbench/moments.tsx": "Chat reasoning disclosure and a failed chat-part rendering message.",
  "workbench/world/lane.tsx": "Chat tool result payload, explicitly expanded by the reader.",
  "route/help.tsx": "The route tutorial body.",
  "route/flow.tsx": "Inspector disclosure shows action/reading relations and runtime state.",
  "route/situation-lamp.tsx": "Inspector disclosure, opened by the reader.",
  "route/situation-marks.tsx": "State details in an explicit popover disclosure.",
};
const excluded = (rel: string) =>
  /(^|\/)(docs?|guide|tutorial|help|chat|design-system|prototypes)(\/|\.)/.test(rel) ||
  rel.startsWith("routes/design-system");

it("working-surface prose cannot grow outside reviewed exceptions", () => {
  const hits = files(ROOT)
    .filter((rel) => !excluded(rel) && !ALLOW[rel])
    .flatMap((rel) =>
      [...readFileSync(join(ROOT, rel), "latin1").matchAll(/\bt-prose\b/g)].map(() => rel),
    );
  // Ratchet: 0 unreviewed t-prose occurrences on 2026-10-23. Exceptions above name the reason.
  expect(hits.length, hits.join("\n")).toBeLessThanOrEqual(0);
});

it("route state keys use kit Legend and Pane's legend dock", () => {
  const stray = [
    ["rooms/plan.tsx", /<FactChip|aria-label="plan legend"/],
    ["takeoff/level-plan.tsx", /<Key\s|pointer-events-none flex max-w-full flex-wrap/],
    ["space/facts.tsx", /<ul[^>]*data-legend=|<li key=\{entry.value\}/],
    ["ducts/proto/encoding/scale-legend.tsx", /plain=|foot=/],
  ] as const;
  expect(
    stray
      .filter(([rel, pattern]) => pattern.test(readFileSync(join(ROOT, rel), "latin1")))
      .map(([rel]) => rel),
  ).toEqual([]);
  for (const rel of [
    "rooms/plan.tsx",
    "takeoff/level-plan.tsx",
    "space/picture.tsx",
    "routes/grilles.tsx",
  ])
    expect(readFileSync(join(ROOT, rel), "latin1"), rel).toContain("legend={");
});
