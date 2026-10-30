import { expect, test } from "vite-plus/test";
import { projectRouteGraph, scheduleGridRouteState, validateRouteGraph } from "@pe/agent-contracts";
import { schedulesGraph, schedulesPageSchema } from "./graph";
import { schedulesAdapters } from "./route";

test("the schedule graph admits the original Work schema, cells and stages", () => {
  expect(validateRouteGraph(schedulesGraph)).toEqual([]);
  expect(schedulesGraph.work).toBe(scheduleGridRouteState.schema);
  expect(schedulesGraph.cells).toHaveLength(1);
  expect(schedulesGraph.cells![0]).toMatchObject({ segment: "cells", nouns: ["column"] });
  expect(schedulesGraph.cells![0]!.groupOf("3::2")).toEqual(["2"]);
  expect(schedulesGraph.stageOrder).toEqual(["audit", "apply", "history"]);
  expect(schedulesGraph.stages.history?.verbs).toEqual([]);
  expect(schedulesGraph.verbs.push?.review).toBe("shown");
  expect(schedulesGraph.verbs.capture?.does).toBe("schedule.capture");
  expect(schedulesGraph.verbs.apply?.does).toBe("schedule.apply");
  expect(schedulesGraph.verbs.read?.does).toBe("schedule.grid.snapshot");
  expect(projectRouteGraph(schedulesGraph).cells).toHaveLength(1);
});

test("Page has no result or preview state and route adapters supply no kernel-owned Work ports", () => {
  const page = schedulesPageSchema.parse({});
  for (const id of ["unread", "refused", "sheet", "confirming"]) {
    expect(page).not.toHaveProperty(id);
    expect(schedulesGraph.fields).not.toHaveProperty(id);
  }
  for (const id of ["getSnapshot", "subscribe", "write", "subscribeAcceptedDeltas"])
    expect(schedulesAdapters).not.toHaveProperty(id);
});
