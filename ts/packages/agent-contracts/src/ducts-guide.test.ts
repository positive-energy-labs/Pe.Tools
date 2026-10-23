import { describe, expect, it } from "vite-plus/test";

import { DUCT_CASES, casesForFindings } from "./ducts-guide.ts";

/**
 * Every string that reaches `DuctFinding.kind` in a `route:ducts.analysis` read, confirmed from
 * `ts/packages/ducts-domain/src`: `survey.ts` (series, no-fan, multi-fan, the flow findings and the
 * snapshot issues it passes through, minus `multi-root` which it replaces with `multi-fan`),
 * `proximity.ts` and `phases.ts` (the inferred joins, `loop-by-inference`, `out-of-phase`) and
 * `assessment.ts` (the catalog findings and the plausibility guard's `implausible-loss`). Heal row kinds (`cap`, `join`, `end`, `verdict`),
 * load-preview line kinds (`no-tag`, `no-cfm`) and node kinds (`passive`) never reach it.
 */
const FINDING_KINDS = new Set([
  "joined-by-proximity",
  "tap-by-proximity",
  "inline-by-inference",
  "near-miss-across-classifications",
  "loop-by-inference",
  "out-of-phase",
  "series-by-inference",
  "no-fan",
  "multi-fan",
  "tag-without-mark",
  "mark-without-system",
  "no-terminals",
  "no-mark",
  "no-flow",
  "open-end",
  "loop",
  "stub",
  "mixed-classification",
  "implausible-size",
  "default-flex-roughness",
  "no-fan-static",
  "no-component-drop",
  "no-terminal-flow",
  "no-root",
  "high-velocity",
  "no-flow-leg",
  "catalog-missing-table",
  "catalog-out-of-range",
  "catalog-file",
  "implausible-loss",
]);
const GRADES = new Set(["near-miss", "stretched", "anomalous"]);

describe("ducts guide cases", () => {
  it("names only finding kinds the domain emits, with a known grade when graded", () => {
    for (const c of DUCT_CASES)
      for (const k of c.kinds) {
        const [kind, grade] = k.split(":");
        expect(FINDING_KINDS.has(kind!), `case ${c.number}: ${k}`).toBe(true);
        if (grade !== undefined) expect(GRADES.has(grade), `case ${c.number}: ${k}`).toBe(true);
      }
  });

  it("numbers every case once", () => {
    expect(new Set(DUCT_CASES.map((c) => c.number)).size).toBe(DUCT_CASES.length);
  });

  it("finds a case from its finding kind", () => {
    const noFan = casesForFindings([{ kind: "no-fan" }]);
    expect(noFan).toHaveLength(1);
    expect(noFan[0]!.count).toBe(1);
    expect(noFan[0]!.case.code).toBe("no-fan");

    const nearMiss = casesForFindings([{ kind: "joined-by-proximity", grade: "near-miss" }]);
    expect(nearMiss.map((r) => r.case.number)).toEqual([1]);
  });
});
