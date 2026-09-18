import { describe, expect, it } from "vite-plus/test";

import {
  partitionReviewSchema,
  takeoffRegionAnalysisSchema,
  takeoffsRouteState,
} from "./takeoffs.ts";
import { preparedTakeoffSchema, takeoffActions } from "./semantic-actions.ts";

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

it("freezes Takeoffs decisions and exposes no competing native decision channels", () => {
  expect(
    preparedTakeoffSchema.parse({
      process: {
        pid: 42,
        processStartUtc: "2026-09-14T00:00:00.000Z",
        executable: "C:\\Program Files\\Autodesk\\Revit 2025\\Revit.exe",
      },
      staged: [],
      decisions: { "room::flag": "accept" },
    }).decisions,
  ).toEqual({ "room::flag": "accept" });
  expect(takeoffActions).not.toHaveProperty("takeoffs.decisions");
  expect(takeoffActions).not.toHaveProperty("takeoffs.room-type");
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
