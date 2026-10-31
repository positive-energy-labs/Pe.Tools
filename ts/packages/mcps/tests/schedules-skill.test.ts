import { expect, test } from "vite-plus/test";
import { scheduleGridRouteState, projectRouteGraph } from "@pe/agent-contracts";
import { schedulesGraph } from "../../../apps/web/src/schedules/graph.ts";
import { renderSchedulesSkill } from "../src/pea/schedules-skill.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";

test("Pea reads the same schedule graph and Work schema as the mounted product", () => {
  expect(schedulesGraph.work).toBe(scheduleGridRouteState.schema);
  const skill = renderSchedulesSkill();
  expect(bundledPeaSkills.find((row) => row.name === "edit-schedule-grid")?.content).toBe(skill);
  expect(skill).toContain(JSON.stringify(projectRouteGraph(schedulesGraph), null, 2));
  expect(skill).toContain("schedule.grid.push");
  expect(skill).toContain("History is read-only");
  expect(skill).toContain("never Page or authored Work");
  expect(Object.keys(schedulesGraph.fields)).not.toEqual(
    expect.arrayContaining(["unread", "refused", "sheet", "confirming"]),
  );
});
