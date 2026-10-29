import { DUCTS_SHEET_GUIDE, ductsSheetRequestSchema } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";
import { ductsGuideReading, renderDuctsSkill } from "../src/pea/ducts-skill.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";

test("pressure-drop guidance shares the sheet guide and never drives the legacy inbox", () => {
  const skill = renderDuctsSkill();
  expect(bundledPeaSkills.find((s) => s.name === "calc-duct-pressure-drop")?.content).toBe(skill);
  for (const step of DUCTS_SHEET_GUIDE.walk) expect(skill).toContain(step);
  expect(skill).toContain("route:ducts.roster");
  expect(skill).toContain("route:ducts.sheet");
  expect(skill).not.toContain("preview-assign-fan");
  expect(skill).not.toContain("Fix, Set, Check, Write");
  expect(skill).toContain("Never compute pressure drop by hand");
  expect(skill).toContain("Never grep");
  expect(skill).toContain("effect on the total");
  expect(/^description: (.+)$/m.exec(skill)?.[1]).not.toContain(": ");
  expect(ductsGuideReading()).toBe(DUCTS_SHEET_GUIDE);
  expect(ductsGuideReading("never")).toEqual({ never: DUCTS_SHEET_GUIDE.never });
});

test("the fan and asserted-chain requests have one discriminated contract", () => {
  const target = { session: "dev", openId: "project" };
  expect(
    ductsSheetRequestSchema.safeParse({ target, mode: "fan", unitId: 14577391, portIndex: 2 })
      .success,
  ).toBe(true);
  expect(
    ductsSheetRequestSchema.safeParse({
      target,
      mode: "chain",
      start: { elementId: 1 },
      end: { elementId: 2 },
      direction: "return",
    }).success,
  ).toBe(true);
  expect(
    ductsSheetRequestSchema.safeParse({
      target,
      mode: "chain",
      start: { elementId: 1 },
      end: { elementId: 2 },
    }).success,
  ).toBe(false);
});
