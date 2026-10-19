import { describe, expect, it } from "vite-plus/test";

import { semanticActions } from "@pe/agent-contracts";

import { actionCall, actionRoute } from "./chat-plugins";

describe("chat plugin records", () => {
  it("an action opens the pane whose manifest declares a verb doing it, never a guess at its words", () => {
    expect(actionRoute("takeoffs.sync")).toBe("takeoffs");
    expect(actionRoute("rooms.merge")).toBe("rooms");
    expect(actionRoute("parameter-links.apply")).toBe("parameter-links");
    expect(actionRoute("family.build")).toBe("family");
    expect(actionRoute("settings.write")).toBe("pods");
    expect(actionRoute("schedule.grid.push")).toBe("schedules");
    expect(actionRoute("instances.open")).toBe("instances");
    // Every semantic action is some pane's: none falls back to a bare receipt link.
    expect(Object.keys(semanticActions).filter((key) => !actionRoute(key))).toEqual([]);
    // No pane declares these: the record keeps its receipt link instead of inventing an owner.
    expect(actionRoute("schedule.nonexistent")).toBeNull();
    expect(actionRoute("pod.list")).toBeNull();
    expect(actionRoute("takeoffs")).toBeNull();
  });

  it("a script contribution key is an action call; a member or an old pod key is not", () => {
    const ran = { structuredContent: { result: { action: { id: "r1" } } } };
    expect(actionCall("pe_do", { key: "script:@snowdon-ducts/src/Census.cs" }, ran)).toEqual({
      id: "r1",
      key: "script:@snowdon-ducts/src/Census.cs",
    });
    expect(actionCall("pe_do", { key: "op:revit.context.lens" }, ran)).toEqual({
      id: "r1",
      key: "revit.context.lens",
    });
    expect(
      actionCall("pe_do", { key: "member:@snowdon-ducts/settings/checks.json" }, ran),
    ).toBeNull();
    expect(actionCall("pe_do", { key: "pod:sheets.rename" }, ran)).toBeNull();
  });
});
