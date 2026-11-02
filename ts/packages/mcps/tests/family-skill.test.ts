import { expect, test } from "vite-plus/test";
import familyGraph from "../src/pea/generated/family-graph.json" with { type: "json" };
import { renderFamilySkill } from "../src/pea/family-skill.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";

test("Pea reads the product Family graph, exact Work schema, cells and recovery verb", () => {
  const projected = familyGraph;
  const skill = renderFamilySkill();
  expect(bundledPeaSkills.find((row) => row.name === "edit-family")?.content).toBe(skill);
  expect(skill).toContain(JSON.stringify(projected, null, 2));
  expect(projected.needs).toBe("family");
  expect(projected.verbs.apply).toMatchObject({ does: "family.apply", review: "shown" });
  expect(projected.verbs.build).toMatchObject({ does: "family.build", review: "shown" });
  expect(projected.verbs.saved).toMatchObject({ does: "family.saved", kind: "query" });
  expect(projected.verbs["work.start-fresh"]).toMatchObject({
    kind: "recovery",
    review: "shown",
  });
  expect(projected.cells).toHaveLength(1);
  expect(projected).not.toHaveProperty("workSubject");
  for (const field of ["reading", "sheet", "confirming", "buildReview", "receipts"])
    expect(familyGraph.fields).not.toHaveProperty(field);
});
