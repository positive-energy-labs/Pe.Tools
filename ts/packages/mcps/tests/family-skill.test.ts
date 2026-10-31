import { expect, test } from "vite-plus/test";
import { familyDraftRouteState, projectRouteGraph } from "@pe/agent-contracts";
import { familyGraph } from "../../../apps/web/src/family/graph.ts";
import { renderFamilySkill } from "../src/pea/family-skill.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";

test("Pea reads the product Family graph, exact Work schema, cells and recovery verb", () => {
  expect(familyGraph.work).toBe(familyDraftRouteState.schema);
  const projected = projectRouteGraph(familyGraph);
  const skill = renderFamilySkill();
  expect(bundledPeaSkills.find((row) => row.name === "edit-family")?.content).toBe(skill);
  expect(skill).toContain(JSON.stringify(projected, null, 2));
  expect(projected.needs).toBe("family");
  expect(projected.verbs.apply).toMatchObject({ does: "family.apply", review: "shown" });
  expect(projected.verbs.build).toMatchObject({ does: "family.build", review: "shown" });
  expect(projected.verbs.saved).toMatchObject({ does: "family.saved", kind: "query" });
  expect(projected.verbs["work.start-fresh"]).toMatchObject({
    kind: "recovery",
    review: "required",
  });
  expect(projected.cells).toHaveLength(1);
  expect(projected.workSubject).toBeUndefined();
  for (const field of ["reading", "sheet", "confirming", "buildReview", "receipts"])
    expect(familyGraph.fields).not.toHaveProperty(field);
});
