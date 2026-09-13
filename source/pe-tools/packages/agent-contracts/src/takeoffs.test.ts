import { describe, expect, it } from "vite-plus/test";

import {
  partitionReviewSchema,
  takeoffRegionAnalysisSchema,
  takeoffsRouteState,
} from "./takeoffs.ts";

it("normalizes omitted native analysis nulls without accepting invalid values", () => {
  expect(takeoffRegionAnalysisSchema.parse({ state: "unmeasured" })).toEqual({
    state: "unmeasured",
    runId: null,
    floorZ: null,
    ceilingZ: null,
    hold: null,
  });
  expect(
    takeoffRegionAnalysisSchema.parse({
      state: "current",
      runId: "run",
      floorZ: 0,
      ceilingZ: 9,
    }).hold,
  ).toBeNull();
  expect(takeoffRegionAnalysisSchema.safeParse({ state: "current", hold: 42 }).success).toBe(false);
});

it("reads accepted review shapes when the transport omits a null reason", () => {
  const data = partitionReviewSchema.parse({
    source: { runId: "run", documentKey: "doc", zoneKey: "zone" },
    zone: { key: "zone", name: "zone", loops: [] },
    shapes: [
      { id: "R01", kind: "room", disposition: "accepted", sqft: 10, label: [0, 0], loops: [] },
    ],
  });
  expect(data.shapes[0]!.reason).toBeNull();
});

describe("takeoffsRouteState", () => {
  it("defaults a new route document to no world", () => {
    expect(takeoffsRouteState.schema.parse({})).toEqual({
      staged: [],
      adoptPatches: {},
      decisions: {},
      reviewFlags: {},
    });
  });

  it("allows staged proposals but rejects snapshot writes", () => {
    const allows = (path: string[]) =>
      takeoffsRouteState.agentWriteMask.some((pattern) =>
        pattern.every((segment, index) => segment === "*" || segment === path[index]),
      );
    expect(allows(["staged", "0"])).toBe(true);
    expect(allows(["snapshot"])).toBe(false);
  });
});

it("discards obsolete persisted page selection while retaining authored Work", () => {
  const staged = [{ roomId: "room", base: { name: "Before" }, next: { name: "Authored" } }];
  expect(
    takeoffsRouteState.schema.parse({
      bindings: { folder: { id: "old" } },
      stage: "audit",
      staged,
    }),
  ).toEqual({ staged, adoptPatches: {}, decisions: {}, reviewFlags: {} });
});

