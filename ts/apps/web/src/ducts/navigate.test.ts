import { describe, expect, it } from "vite-plus/test";

import { navigate } from "./navigate";

type Snap = Parameters<typeof navigate>[0];
const node = (id: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    kind: "terminal",
    facts: [],
    connectors: [],
    ...extra,
  }) as unknown as Snap["nodes"][number];
const group = (id: string, systemNames: string[]) =>
  ({ id, rootIds: [], issueIds: [], systemNames }) as unknown as Snap["groups"][number];

const snapshot: Snap = {
  groups: [group("g1", ["SA 19"]), group("g2", ["RA 3", "SA 2"])],
  nodes: [
    node(10, { kind: "equipment", groupId: "g1", systemName: "SA 19", label: "FC-17" }),
    node(11, {
      groupId: "g1",
      systemName: "SA 19",
      facts: [{ key: "mark", text: "G-4" }],
    }),
    node(20, { groupId: "g2", systemName: null }),
  ],
  segments: [{ id: 30, groupId: "g1", systemName: "SA 19", connectors: [] } as never],
};

describe("navigate the read snapshot", () => {
  it("a system name opens it with nothing selected", () => {
    expect(navigate(snapshot, " sa 19 ")).toEqual({ system: "SA 19", selected: "", says: "SA 19" });
  });
  it("an element id, node or segment, opens its system and selects it", () => {
    expect(navigate(snapshot, "30")).toMatchObject({ system: "SA 19", selected: "30" });
    expect(navigate(snapshot, "11")).toMatchObject({ system: "SA 19", selected: "11" });
  });
  it("an element with no system of its own takes its network's first system, and says the rest", () => {
    expect(navigate(snapshot, "20")).toEqual({
      system: "RA 3",
      selected: "20",
      says: "20 in RA 3 (also in SA 2)",
    });
  });
  it("a unit label, a mark or a name the screen shows selects its element", () => {
    expect(navigate(snapshot, "fc-17")).toMatchObject({ system: "SA 19", selected: "10" });
    expect(navigate(snapshot, "G-4")).toMatchObject({ selected: "11" });
    expect(navigate(snapshot, "Grille 9", new Map([[11, "Grille 9"]]))).toMatchObject({
      selected: "11",
    });
  });
  it("unknown input is not in this snapshot", () => {
    expect(navigate(snapshot, "999")).toEqual({
      system: null,
      says: "999: not in this snapshot",
    });
    expect(navigate(snapshot, "XX-1").system).toBeNull();
  });
});
