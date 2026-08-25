import { describe, expect, it } from "vite-plus/test";

import { takeoffsRouteState } from "./takeoffs.ts";

const ProjectASnapshot = {
  world: {
    docName: "project-a Residence.rvt",
    r10Path: null,
    lanes: [],
    zones: [],
    systems: [],
  },
  views: [],
  zoneFrs: [],
  regionsByZone: {},
};

describe("takeoffsRouteState", () => {
  it("round-trips the project-a fixture snapshot", () => {
    const document = {
      binding: { target: null },
      snapshot: ProjectASnapshot,
      staged: [],
    };
    expect(takeoffsRouteState.schema.parse(document)).toEqual(document);
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
