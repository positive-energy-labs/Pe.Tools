/**
 * Per-terminal flow order, adapted from `terminal-flows.test.ts`: a typed override first, then
 * the one confirmed slot, then a room share; a missing value is a `no-flow` blocker and Revit's
 * own flow never stands in for the confirmed slot (map, history 6).
 */
import { describe, expect, it } from "vite-plus/test";

import type { DuctSnapshot } from "../types.ts";
import { slotFlowOf, terminalFlow } from "./terminal-flow.ts";

type Node = DuctSnapshot["nodes"][number];
const terminal = (flow: number | null, flowParameter: string | null): Node =>
  ({
    id: 40, kind: "terminal", category: "Air Terminals", point: [0, 0, 9], connectors: [], flowParameter,
    facts: flow == null ? [] : [{ key: "flow", value: flow, unit: "cfm", provenance: "designer-stated" }],
  }) as unknown as Node;

describe("terminalFlow", () => {
  it("takes the override, then the confirmed slot, then the room", () => {
    const room = { cfm: 111, source: "room 101" };
    expect(terminalFlow({ override: 150, confirmed: { slot: "PE_Airflow", cfm: 120 }, room })).toEqual({ flow: 150, source: "override", blocker: null });
    expect(terminalFlow({ confirmed: { slot: "PE_Airflow", cfm: 120 }, room })).toEqual({ flow: 120, source: "slot:PE_Airflow", blocker: null });
    expect(terminalFlow({ confirmed: { slot: "PE_Airflow", cfm: null }, room })).toEqual({ flow: 111, source: "rooms:room 101", blocker: null });
  });

  it("a missing value is a no-flow blocker, never a fallback", () => {
    expect(terminalFlow({ confirmed: { slot: "PE_Airflow", cfm: null } })).toEqual({ flow: null, source: null, blocker: "no-flow" });
    expect(terminalFlow({ confirmed: { slot: "PE_Airflow", cfm: 0 } })).toEqual({ flow: null, source: null, blocker: "no-flow" });
  });
});

describe("slotFlowOf", () => {
  it("reads the flow fact only when the snapshot's flow parameter is the confirmed slot", () => {
    expect(slotFlowOf(terminal(120, "PE_Airflow"), "PE_Airflow")).toEqual({ slot: "PE_Airflow", cfm: 120 });
    // Revit's own Flow filled the fact: not the confirmed slot, so no value.
    expect(slotFlowOf(terminal(120, "Flow"), "PE_Airflow")).toEqual({ slot: "PE_Airflow", cfm: null });
    // An older snapshot names no parameter: the fact is taken as the slot's.
    expect(slotFlowOf(terminal(120, null), "PE_Airflow")).toEqual({ slot: "PE_Airflow", cfm: 120 });
    expect(slotFlowOf(terminal(null, "PE_Airflow"), "PE_Airflow")).toEqual({ slot: "PE_Airflow", cfm: null });
  });
});
