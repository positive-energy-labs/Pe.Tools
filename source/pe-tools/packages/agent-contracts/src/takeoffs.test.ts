import { describe, expect, it } from "vite-plus/test";

import { partitionReviewSchema, takeoffsRouteState } from "./takeoffs.ts";

it("reads accepted review shapes when the transport omits a null reason", () => {
  const data = partitionReviewSchema.parse({
    source: { runId: "run", documentKey: "doc", scopeKey: "zone" },
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
      bindings: {},
      snapshot: null,
      staged: [],
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
