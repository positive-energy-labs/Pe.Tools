import { expect, it } from "vite-plus/test";

import { LOSS_RULES, type FittingFacts } from "./loss-rules.ts";
import type { LossResult } from "./losses.ts";
import { catalogFindings } from "./pricing.ts";

const accessory = (family: string | null): FittingFacts => ({
  kind: "accessory",
  family,
  partType: null,
  rOverD: null,
  aoOverA1: null,
  inlet: { shape: "round", section: null },
  outlet: null,
  main: null,
  abOverAc: null,
  takeoff: false,
});
const ruleOf = (family: string | null) =>
  LOSS_RULES.find((rule) => rule.when(accessory(family), { q: 100 }))?.key ?? null;

it("prices only a plain damper family as the fully open damper; every other accessory has no rule", () => {
  expect(ruleOf("Volume Damper - Rectangular")).toBe("damper");
  expect(ruleOf("Mechanical Damper")).toBe("damper");
  expect(ruleOf("Fire Damper")).toBeNull();
  expect(ruleOf("Smoke Damper")).toBeNull();
  expect(ruleOf("Flex Connector")).toBeNull();
  expect(ruleOf(null)).toBeNull();
});

it("gathers the fittings no rule prices into one no-rule finding per family", () => {
  const row = (id: number, family?: string) => ({
    id,
    kind: "fitting" as const,
    dp: 0,
    desc: "no rule",
    error: "no rule",
    finding: "no-rule" as const,
    ...(family ? { family } : {}),
  });
  const result = {
    paths: { 1: { rows: [row(7, "Flex Connector"), row(5, "Flex Connector"), row(9)] } },
  } as unknown as LossResult;
  const found = catalogFindings(result);
  expect(found.map((f) => [f.id, f.kind, f.elementIds])).toEqual([
    ["no-rule:Flex Connector", "no-rule", [5, 7]],
    ["no-rule:#9", "no-rule", [9]],
  ]);
});
