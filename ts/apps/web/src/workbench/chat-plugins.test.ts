import { describe, expect, it } from "vite-plus/test";

import { semanticActions } from "@pe/agent-contracts";

import { actionRoute, capturedPlace } from "./chat-plugins";

describe("chat plugin records", () => {
  it("a recorded schedule opens its declared workspace and retains the execution document", () => {
    const place = capturedPlace(
      "schedules",
      {
        binding: "workspace",
        route: "schedules",
        target: null,
        work: "schedule-42",
      },
      {},
      { kind: "open", ref: { session: "one", openId: "original" } },
    );
    expect(place).toMatchObject({
      ok: true,
      page: { workspaceId: "schedule-42" },
      carry: {
        work: "schedule-42",
        target: JSON.stringify({ kind: "open", ref: { session: "one", openId: "original" } }),
      },
    });
    expect(capturedPlace("schedules", null, {})).toMatchObject({ ok: false });
  });
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
});
