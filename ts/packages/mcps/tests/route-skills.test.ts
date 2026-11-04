import { expect, test } from "vite-plus/test";
import family from "../src/pea/generated/family-graph.json" with { type: "json" };
import families from "../src/pea/generated/families-graph.json" with { type: "json" };
import schedules from "../src/pea/generated/schedules-graph.json" with { type: "json" };
import { bundledPeaSkills } from "../src/pea/skills.ts";

test("published route skills carry the product graph and explain the reviewed command boundary", () => {
  for (const [name, graph, promises] of [
    ["edit-family", family, ["sealed plan id", "Work revision", "Start fresh"]],
    [
      "edit-loaded-families",
      families,
      ["sealed plan id", "Work changes make the review stale", "History is read-only"],
    ],
    [
      "edit-schedule-grid",
      schedules,
      ["schedule.grid.push", "History is read-only", "never Page or authored Work"],
    ],
  ] as const) {
    const skill = bundledPeaSkills.find((row) => row.name === name)?.content;
    expect(skill, name).toBeDefined();
    const body = /```json\n([\s\S]*?)\n```/.exec(skill!)?.[1];
    expect(JSON.parse(body!), name).toEqual(graph);
    for (const promise of promises) expect(skill, name).toContain(promise);
  }
});
