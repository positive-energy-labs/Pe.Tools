import { designOf } from "@pe/ducts-domain/test-design";
import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import {
  applyPatches,
  ductsRouteState,
  cellPatches,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";

import { ISSUE_KINDS } from "./issues";
import { readiness } from "@pe/ducts-domain/readiness";
import { groupOf, issueOf, nodeOf, snapshotOf } from "@pe/ducts-domain/test-snapshot";

/** One supply group off AHU 9: an open end and an accessory with no drop. */
const snapshot = snapshotOf({
  document: {
    title: "t",
    readAt: "2026-09-26T00:00:00Z",
    elapsedMs: 1,
    networkBasedCalculations: false,
  },
  groups: [
    groupOf("g1", {
      rootIds: [9],
      classifications: ["Supply Air"],
      systemNames: ["SA 1"],
      terminalCount: 1,
      elementCount: 4,
      issueIds: ["open-end:2:1", "no-component-drop:3"],
    }),
  ],
  nodes: [
    nodeOf(3, "accessory", { category: "Duct Accessories", family: "Damper", point: [0, 0, 0] }),
    nodeOf(9, "equipment", { category: "Mechanical Equipment", family: "AHU", point: [0, 0, 0] }),
  ],
  issues: [
    issueOf("open-end:2:1", "open-end", 2, { point: [0, 0, 0] }),
    issueOf("no-component-drop:3", "no-component-drop", 3, { point: [0, 0, 0] }),
  ],
});

it("a group climbs from blocked to walkable to budgetable as a person stages assumptions", () => {
  const stage = (doc: DuctsRouteDocument, key: string, value: unknown) => {
    const patches = cellPatches(["assumptions"], key, {}, { kind: "set", rung: { value } });
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
  expect(readiness(snapshot, designOf(doc)).g1).toEqual({
    level: "blocked",
    walk: ["open-end:2:1"],
    budget: ["no-component-drop:3"],
  });
  doc = stage(doc, "open-end:2:1", { kind: "verdict", verdict: "capped" });
  expect(readiness(snapshot, designOf(doc)).g1?.level).toBe("walkable");
  // Pea stages the same assumption immediately.
  const proposed = designOf({
    ...doc,
    assumptions: {
      ...doc.assumptions,
      "component-drop:Damper": { edit: { value: { kind: "component-drop", inWg: 0.05 } } },
    },
  });
  expect(readiness(snapshot, proposed).g1?.level).toBe("budgetable");
  doc = stage(doc, "component-drop:Damper", { kind: "component-drop", inWg: 0.05 });
  expect(readiness(snapshot, designOf(doc)).g1).toEqual({
    level: "budgetable",
    walk: [],
    budget: [],
  });
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
