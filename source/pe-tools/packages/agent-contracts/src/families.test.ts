import { describe, expect, it } from "vite-plus/test";

import { familiesRouteState } from "./families.ts";

describe("familiesRouteState", () => {
  it("supplies the empty plan-hash chain defaults", () => {
    expect(familiesRouteState.schema.parse({})).toEqual({
      bindings: {},
      profilePath: null,
      plan: null,
      excludedIds: [],
      apply: null,
    });
  });

  it("keeps apply human-only and exposes only the two agent patch homes", () => {
    expect(familiesRouteState.agentWriteMask).toEqual([["excludedIds"], ["profilePath"]]);
    expect(familiesRouteState.commands.apply?.actor).toBe("human");
  });
});
