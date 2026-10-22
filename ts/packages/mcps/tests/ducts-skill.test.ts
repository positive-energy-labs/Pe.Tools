import {
  DUCTS_GUIDE,
  DUCTS_LIMITS,
  DUCTS_PEA_NEVER,
  DUCTS_RESIDENCY,
  DUCTS_WALK,
} from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";
import { ductsGuideReading, presentDuctCases, renderDuctsSkill } from "../src/pea/ducts-skill.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";

test("the bundled ducts skill is projected from DUCTS_GUIDE and keeps the operational keys", () => {
  const skill = renderDuctsSkill();
  expect(bundledPeaSkills.find((s) => s.name === "calc-duct-pressure-drop")?.content).toBe(skill);
  for (const step of DUCTS_WALK) expect(skill).toContain(step.step);
  for (const line of [...DUCTS_LIMITS, ...DUCTS_PEA_NEVER]) expect(skill).toContain(line);
  for (const row of DUCTS_RESIDENCY) expect(skill).toContain(row.value);
  for (const key of [
    "route:ducts.set-view",
    "workflow:ducts.preview-heal",
    "workflow:ducts.apply-heal",
    "workflow:ducts.preview-assign-fan",
    "route:ducts.propose",
    "route:ducts.guide",
  ])
    expect(skill).toContain(key);
  expect(skill).toContain(
    "Never rebuild it with pod or C# scripts; they will not match the page the person reads",
  );
  expect(skill).not.toContain("Project A");
  // The cases stay in the read, not the skill.
  expect(skill).not.toContain(DUCTS_GUIDE.cases[0]!.whatWeDo);
  const description = /^description:\s*(.+)$/m.exec(skill)?.[1] ?? "";
  expect(description).not.toContain(': "');
  expect(description).not.toContain(": ");
  for (const word of ["ESP", "Naviate", "Manual D", "airflow slot", "survives a save"])
    expect(description).toContain(word);
});

test("the guide read cuts cases to their identity unless cases are asked for", () => {
  const brief = ductsGuideReading().cases as Record<string, unknown>[];
  expect(brief).toHaveLength(DUCTS_GUIDE.cases.length);
  expect(Object.keys(brief[0]!).sort()).toEqual(
    ["code", "group", "kinds", "number", "status", "title"].sort(),
  );
  expect(ductsGuideReading("cases")).toEqual({ cases: DUCTS_GUIDE.cases });
  expect(ductsGuideReading("limits")).toEqual({ limits: DUCTS_GUIDE.limits });
});

test("present cases carry counts and at most ten element ids", () => {
  const kase = DUCTS_GUIDE.cases.find((c) => c.kinds.length)!;
  const kind = kase.kinds[0]!.split(":")[0]!;
  const grade = kase.kinds[0]!.split(":")[1] ?? null;
  const findings = Array.from({ length: 12 }, (_, i) => ({ kind, grade, elementIds: [i + 1] }));
  const counts = { [kase.kinds[0]!]: 12 };
  const present = presentDuctCases(counts, findings).find((p) => p.number === kase.number)!;
  expect(present).toMatchObject({ title: kase.title, code: kase.code });
  expect(present.count).toBeGreaterThanOrEqual(12);
  expect(present.elementIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("the skill carries each comparison cell's evidence, not only its note", () => {
  const skill = renderDuctsSkill();
  for (const { rows } of DUCTS_GUIDE.compare)
    for (const row of rows)
      for (const c of [row.revit, row.naviate, row.pe])
        if (c.detail) expect(skill).toContain(c.detail.replace(/\.$/, ""));
});
