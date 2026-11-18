import { expect, it } from "vite-plus/test";
import { encounterRows } from "./encounter-closer.ts";
import type { FanIssue } from "@pe/fans-contract/fans-inputs";
it("only a ruleable tie-in offers accept and refuse in the network inbox", () => {
  const issue: FanIssue = { id: "backflow:20:0", kind: "backflow", elementId: 20, severity: "blocking",
    closer: { kind: "encounter", encounter: { fan: { unitId: 300, portIndex: 0 }, host: { unitId: 200, portIndex: 0 },
      elementId: 20, connector: 0, side: "supply", verdict: "unruled", static: { kind: "none" } } } };
  expect(encounterRows([issue])[0]!.verbs.map(v => v.kind === "encounter" ? v.label : "")).toEqual(["accept encounter", "refuse encounter"]);
  expect(encounterRows([{ ...issue, closer: { kind: "none", reason: "backflow/deadhead" } }])).toEqual([]);
  if (issue.closer.kind !== "encounter") throw Error("Expected the ruleable fixture encounter");
  const warning = encounterRows([{ ...issue, severity: "warning", closer: { ...issue.closer,
    encounter: { ...issue.closer.encounter, verdict: "accepted" } } }])[0]!;
  expect(warning.blocks).toBe(false); // P-112: a resolved warning never holds the network.
});
