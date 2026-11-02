import { expect, test } from "vite-plus/test";
import familiesGraph from "../src/pea/generated/families-graph.json";
import { renderFamiliesSkill } from "../src/pea/families-skill.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";

test("Pea reads the same Families graph, Work schema, cells and recovery verbs as the product", () => {
  const projected = familiesGraph;
  const skill = renderFamiliesSkill();
  expect(bundledPeaSkills.find((row) => row.name === "edit-loaded-families")?.content).toBe(skill);
  expect(skill).toContain(JSON.stringify(projected, null, 2));
  expect(projected.verbs.apply).toMatchObject({ does: "families.apply", review: "shown" });
  expect(projected.verbs.read).toMatchObject({ does: "families.read", kind: "query" });
  expect(projected.verbs["work.salvage"]).toMatchObject({ kind: "recovery", review: "shown" });
  for (const field of ["reading", "sheet", "confirming", "carryOver", "receipts"])
    expect(familiesGraph.fields).not.toHaveProperty(field);
});
