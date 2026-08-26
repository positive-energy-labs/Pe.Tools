import { describe, expect, it } from "vite-plus/test";

import { takeoffsRouteState } from "./takeoffs.ts";

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
