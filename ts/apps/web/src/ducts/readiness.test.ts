import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import {
  applyPatches,
  ductsRouteState,
  transitionPatches,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";

import { ISSUE_KINDS } from "./issues";
import { readiness, type DuctSnapshot } from "./readiness";

const issue = (id: string, kind: DuctSnapshot["issues"][number]["kind"], elementId: number) => ({
  id,
  kind,
  elementId,
  point: [0, 0, 0],
  groupId: "g1",
  note: "",
});

/** One supply group off AHU 9: an open end, an accessory with no drop, an AHU with no fan static. */
const snapshot = {
  group: "g1",
  document: { title: "t", readAt: "2026-09-26T00:00:00Z", elapsedMs: 1 },
  levels: [],
  groups: [
    {
      id: "g1",
      rootIds: [9],
      classifications: ["Supply Air"],
      systemNames: ["SA 1"],
      terminalCount: 1,
      elementCount: 4,
      loops: 0,
      rootNames: ["AHU"],
      segmentCount: 0,
      designCfm: 0,
      issueCounts: [],
    },
  ],
  nodes: [
    {
      id: 3,
      kind: "accessory",
      category: "Duct Accessories",
      family: "Damper",
      point: [0, 0, 0],
      connectors: [],
      facts: [],
    },
    {
      id: 9,
      kind: "equipment",
      category: "Mechanical Equipment",
      family: "AHU",
      point: [0, 0, 0],
      connectors: [],
      facts: [],
    },
  ],
  segments: [],
  flows: [],
  issues: [
    issue("open-end:g1:2:1", "open-end", 2),
    issue("no-component-drop:g1:3", "no-component-drop", 3),
    issue("no-fan-static:g1:9", "no-fan-static", 9),
  ],
  layers: [],
} as DuctSnapshot;

it("a group climbs from blocked to walkable to budgetable as a person stages assumptions", () => {
  const stage = (doc: DuctsRouteDocument, key: string, value: unknown) => {
    const patches = transitionPatches(["assumptions"], key, {}, { kind: "stage", rung: { value } });
    const landed = applyPatches(
      ductsRouteState,
      { version: 1, revision: 0, doc },
      "human",
      patches,
      0,
    );
    if (!landed.ok) throw Error(JSON.stringify(landed));
    return landed.envelope.doc;
  };
  let doc = ductsRouteState.schema.parse({});
  expect(readiness(snapshot, doc).g1).toEqual({
    level: "blocked",
    walk: ["open-end:g1:2:1"],
    budget: ["no-component-drop:g1:3", "no-fan-static:g1:9"],
  });
  doc = stage(doc, "open-end:g1:2:1", { kind: "verdict", verdict: "capped" });
  expect(readiness(snapshot, doc).g1?.level).toBe("walkable");
  // A proposal is not an assumption until a person stages it.
  const proposed = ductsRouteState.schema.parse({
    ...doc,
    assumptions: {
      ...doc.assumptions,
      "fan-static:9": { proposal: { value: { kind: "fan-static", inWg: 0.5 } } },
    },
  });
  expect(readiness(snapshot, proposed).g1?.level).toBe("walkable");
  doc = stage(doc, "fan-static:9", { kind: "fan-static", inWg: 0.5 });
  doc = stage(doc, "component-drop:Damper", { kind: "component-drop", inWg: 0.05 });
  expect(readiness(snapshot, doc).g1).toEqual({ level: "budgetable", walk: [], budget: [] });
});

it("every issue kind the C# enum can emit has one taxonomy entry, and no entry is orphaned", () => {
  const source = readFileSync(
    new URL("../../../../../dotnet/Pe.Shared.RevitData/Ducts/DuctContracts.cs", import.meta.url),
    "utf8",
  );
  const body = source.slice(source.indexOf("enum DuctIssueKind"));
  const emitted = [...body.slice(0, body.indexOf("}")).matchAll(/EnumMember\(Value = "([^"]+)"\)/g)]
    .map((match) => match[1])
    .sort();
  expect(emitted.length).toBeGreaterThan(0);
  expect(Object.keys(ISSUE_KINDS).sort()).toEqual(emitted);
});
