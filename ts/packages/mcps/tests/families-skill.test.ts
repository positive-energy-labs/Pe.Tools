import { expect, test } from "vite-plus/test";
import { familiesRouteState, projectRouteGraph } from "@pe/agent-contracts";
import { familiesGraph } from "../../../apps/web/src/families/graph.ts";
import { renderFamiliesSkill } from "../src/pea/families-skill.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";

test("Pea reads the same Families graph, Work schema, cells and recovery verbs as the product", () => {
  expect(familiesGraph.work).toBe(familiesRouteState.schema);
  const projected = projectRouteGraph(familiesGraph);
  const skill = renderFamiliesSkill();
  expect(bundledPeaSkills.find((row) => row.name === "edit-loaded-families")?.content).toBe(skill);
  expect(skill).toContain(JSON.stringify(projected, null, 2));
  expect(projected.verbs.apply).toMatchObject({ does: "families.apply", review: "shown" });
  expect(projected.verbs.read).toMatchObject({ does: "families.read", kind: "query" });
  expect(projected.verbs["work.salvage"]).toMatchObject({ kind: "recovery", review: "required" });
  for (const field of ["reading", "sheet", "confirming", "carryOver", "receipts"])
    expect(familiesGraph.fields).not.toHaveProperty(field);
});
