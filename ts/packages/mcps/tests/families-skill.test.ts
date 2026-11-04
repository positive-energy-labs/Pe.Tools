import { expect, test } from "vite-plus/test";
import familiesGraph from "../src/pea/generated/families-graph.json" with { type: "json" };
import { renderFamiliesSkill } from "../src/pea/families-skill.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";

test("Pea reads the same Families graph, Work schema, cells and recovery verbs as the product", () => {
  const projected = familiesGraph;
  const skill = renderFamiliesSkill();
  expect(bundledPeaSkills.find((row) => row.name === "edit-loaded-families")?.content).toBe(skill);
  expect(skill).toContain(JSON.stringify(projected, null, 2));
  expect(projected.verbs.apply).toMatchObject({ entry: "families.apply", review: "shown" });
  expect(projected.verbs.read).toMatchObject({ entry: "families.read", kind: "query" });
  // REGEN/U2r: kernel recovery is a route slot, rather than a legacy authored verb.
  expect(projected.salvage).toBe("salvage");
  expect(projected.work).toEqual({ route: "families", schema: "work", version: 1, migrations: {} });
  for (const field of ["reading", "sheet", "confirming", "carryOver", "receipts"])
    expect(familiesGraph.fields).not.toHaveProperty(field);
});
