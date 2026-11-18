import { describe, expect, it } from "vite-plus/test";

import { factOf, nodeOf } from "../test-snapshot.ts";
import { slotFlowOf } from "./terminal-flow.ts";

const terminal = (flow: number | null, flowParameter: string | null) =>
  nodeOf(40, "terminal", {
    category: "Air Terminals",
    point: [0, 0, 9],
    flowParameter,
    facts:
      flow == null ? [] : [factOf("flow", flow, { unit: "cfm", provenance: "designer-stated" })],
  });

describe("slotFlowOf", () => {
  it("reads the flow fact only when the snapshot's flow parameter is the confirmed slot", () => {
    expect(slotFlowOf(terminal(120, "PE_Airflow"), "PE_Airflow")).toEqual({
      slot: "PE_Airflow",
      cfm: 120,
    });
    // Revit's own Flow filled the fact: not the confirmed slot, so no value.
    expect(slotFlowOf(terminal(120, "Flow"), "PE_Airflow")).toEqual({
      slot: "PE_Airflow",
      cfm: null,
    });
    // An older snapshot names no parameter: the fact is taken as the slot's.
    expect(slotFlowOf(terminal(120, null), "PE_Airflow")).toEqual({ slot: "PE_Airflow", cfm: 120 });
    expect(slotFlowOf(terminal(null, "PE_Airflow"), "PE_Airflow")).toEqual({
      slot: "PE_Airflow",
      cfm: null,
    });
  });
});
