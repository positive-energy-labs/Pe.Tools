import { expect, test } from "vite-plus/test";
import { peaAgentInstructions } from "../src/pea/instructions.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";
import { productGuides } from "../src/pea/guides.generated.ts";
import { renderDuctsSkill } from "../../../products/fans/contract/src/pea/ducts-skill.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderProductGuides } from "../../../apps/web/scripts/product-guides.ts";

test("guide composition discovers contract package registrations", () => {
  const checkout = fileURLToPath(new URL("../../../../", import.meta.url));
  expect(readFileSync(new URL("../src/pea/guides.generated.ts", import.meta.url), "utf8"))
    .toBe(renderProductGuides(checkout));
});

test("published instructions and skills carry every registered product guide", () => {
  expect(productGuides.length).toBeGreaterThan(0);
  for (const guide of productGuides) {
    if (guide.instructions) expect(peaAgentInstructions).toContain(guide.instructions);
    for (const skill of guide.skills) expect(bundledPeaSkills).toContainEqual(skill);
  }
  const calc = renderDuctsSkill();
  for (const id of ["fans.calc", "fans.calc-detail", "fans.calc-breakdown"])
    expect(calc).toContain(id);
  expect(calc).toContain("Required ESP is a computed result, never staged");
  expect(calc).toContain("writes nowhere");
  expect(calc).toContain("Fix in /duct-systems");
  expect(calc).not.toMatch(/ducts\.analysis|ducts\.sheet|writeIntent\.groups/);
});
