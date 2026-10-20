import { describe, expect, it } from "vite-plus/test";
import { ductsRouteState, type DuctFinding } from "@pe/agent-contracts";

import { inboxRows, proximityIds, writeBlocked, type InboxItem, type TriageInput } from "./inbox-rows";
import type { Claim } from "./legs";

const node = (id: number, kind: string, groupId: string | null) =>
  ({ id, kind, groupId, facts: [], connectors: [] }) as unknown as TriageInput["snapshot"]["nodes"][number];
const group = (id: string, rootIds: number[], issueIds: string[] = []) =>
  ({
    id,
    rootIds,
    issueIds,
    classifications: [],
    systemNames: [],
    terminalCount: 0,
    elementCount: 0,
    loops: 0,
  }) as unknown as TriageInput["snapshot"]["groups"][number];

const snapshot: TriageInput["snapshot"] = {
  groups: [group("g1", [1], ["open-end:g1:2:1"]), group("g2", [], [])],
  nodes: [
    node(1, "equipment", null),
    node(30, "terminal", "g1"),
    node(31, "terminal", "g1"),
    node(40, "terminal", "g2"),
  ],
  segments: [],
};
const finding = (f: Partial<DuctFinding> & Pick<DuctFinding, "id" | "kind">): DuctFinding => ({
  elementIds: [],
  note: f.id,
  assumed: null,
  clearer: "person",
  ...f,
});
const findings = [
  finding({ id: "open-end:g1:2:1", kind: "open-end", elementIds: [2] }),
  finding({ id: "no-fan:g2", kind: "no-fan", groupId: "g2", elementIds: [40] }),
  finding({ id: "proximity:5:0|6:0", kind: "joined-by-proximity", elementIds: [5, 6], grade: "near-miss" }),
  finding({ id: "proximity:7:0|8:0", kind: "joined-by-proximity", elementIds: [7, 8], grade: "stretched" }),
  finding({ id: "proximity:9:0|10:0", kind: "joined-by-proximity", elementIds: [9, 10], grade: "anomalous" }),
  finding({ id: "catalog:catalog-missing-table:31", kind: "catalog-missing-table", elementIds: [31] }),
  finding({ id: "flow:no-flow:30", kind: "no-flow", elementIds: [30], clearer: "pea" }),
  finding({ id: "stub:g1:3", kind: "stub", elementIds: [3] }),
];
const base = {
  snapshot,
  group: "",
  findings,
  flows: new Map<number, { cfm: number | null }>([
    [30, { cfm: null }],
    [31, { cfm: 120 }],
    [40, { cfm: null }],
  ]),
  equipmentFlows: new Map<number, { cfm: number | null }>([[1, { cfm: null }]]),
  doc: null,
  claims: [] as Claim[],
  write: { staged: 0, hasPreview: false, fresh: false, planned: null, refused: null },
};
const keys = (items: readonly InboxItem[]) => items.map((i) => i.key);

describe("a staged verdict is a ruling, not a Revit write", () => {
  const doc = ductsRouteState.schema.parse({
    assumptions: { "open-end:g1:2:1": { staged: { value: { kind: "verdict", verdict: "capped" } } } },
  });
  it("a capped open end leaves Fix for Diagnostics with its take-back", () => {
    const rows = inboxRows({ ...base, doc });
    expect(keys(rows.fix)).not.toContain("open-end:g1:2:1");
    const ruled = rows.diagnostics.find((r) => r.key === "open-end:g1:2:1")!;
    expect(ruled.status).toBe("ruled: capped");
    expect(ruled.verbs[0]).toMatchObject({ kind: "verdict", verdict: "capped", on: true, label: "take back" });
  });
  it("the Write row counts rulings apart from Revit writes", () => {
    const rows = inboxRows({ ...base, doc, write: { ...base.write, rulings: 2 } });
    expect(rows.write.status).toBe(
      "2 rulings staged · nothing to write to Revit yet: stage a flow, ESP, rule or drop",
    );
    expect(inboxRows(base).write.status).toBe("nothing staged");
  });
});

describe("the ducts inbox", () => {
  it("puts blocking findings under Fix, inputs under Set and bridged joins under Diagnostics", () => {
    const rows = inboxRows(base);
    expect(keys(rows.fix)).toEqual([
      "open-end:g1:2:1",
      "no-fan:g2",
      "proximity:9:0|10:0",
      "catalog:catalog-missing-table:31",
    ]);
    // Terminal 30 has no flow; 40 sits in a group with no fan, so only its Fix row stands.
    expect(keys(rows.set)).toEqual(["flows:30", "equipmentFlows:1"]);
    expect(keys(rows.diagnostics)).toEqual(["proximity:5:0|6:0", "proximity:7:0|8:0"]);
    // The advisory stub and the no-flow finding (a Set row now) make no row of their own.
    expect(keys([...rows.fix, ...rows.set, ...rows.diagnostics])).not.toContain("stub:g1:3");
  });

  it("scopes to the chosen group, no-fan by its group id", () => {
    const g2 = inboxRows({ ...base, group: "g2" });
    expect(keys(g2.fix)).toEqual(["no-fan:g2"]);
    expect(g2.set).toEqual([]);
    const g1 = inboxRows({ ...base, group: "g1" });
    expect(keys(g1.fix)).toEqual(["open-end:g1:2:1", "catalog:catalog-missing-table:31"]);
    expect(keys(g1.set)).toEqual(["flows:30", "equipmentFlows:1"]);
  });

  it("every row outside Diagnostics has a verb; Set rows deep-link to their cell", () => {
    const rows = inboxRows(base);
    for (const row of [...rows.fix, ...rows.set, ...rows.check]) expect(row.verbs.length).toBeGreaterThan(0);
    const flow = rows.set[0]!.verbs.find((v) => v.kind === "focus");
    expect(flow).toMatchObject({ kind: "focus", cell: { segment: "flows", id: 30 } });
    const catalog = rows.fix.find((r) => r.kind === "catalog-missing-table")!;
    expect(catalog.verbs[0]).toMatchObject({ kind: "focus", cell: { segment: "terminalDrops", id: 31 } });
  });

  it("an objection stages the proximity ignore verdict and stays in Diagnostics with its take-back, never in Fix", () => {
    const object = inboxRows(base).diagnostics[0]!.verbs[0]!;
    expect(object).toMatchObject({ kind: "verdict", verdict: "ignore", label: "object", on: false });
    const doc = ductsRouteState.schema.parse({
      assumptions: {
        "proximity:5:0|6:0": { staged: { value: { kind: "verdict", verdict: "ignore" } } },
      },
    });
    const after = inboxRows({
      ...base,
      doc,
      findings: findings.filter((f) => f.id !== "proximity:5:0|6:0"),
    });
    expect(keys(after.fix)).not.toContain("proximity:5:0|6:0");
    expect(after.diagnostics.find((r) => r.key === "proximity:5:0|6:0")).toMatchObject({
      kind: "objection",
      ids: [5, 6],
    });
  });

  it("a no-fan row offers to stage a passive root as the fan", () => {
    const doc = ductsRouteState.schema.parse({
      roles: { "1": { staged: { value: { role: "passive" } } } },
    });
    const rows = inboxRows({
      ...base,
      doc,
      findings: [finding({ id: "no-fan:g1", kind: "no-fan", groupId: "g1", elementIds: [30, 31] })],
    });
    expect(rows.fix[0]!.verbs[0]).toMatchObject({ kind: "role", id: 1, role: "fan" });
    // g1 has no air mover now, so its terminals and unit are not asked for inputs.
    expect(keys(rows.set)).toEqual(["flows:40"]);
  });


  it("several roots offers each root as passive; a loop offers to break its inferred join", () => {
    const rows = inboxRows({
      ...base,
      findings: [
        finding({ id: "multi-root:g1", kind: "multi-root", groupId: "g1", elementIds: [1, 2] }),
        finding({ id: "loop-by-inference:5:0|6:0", kind: "loop-by-inference", elementIds: [5, 6] }),
      ],
    });
    const roots = rows.fix.find((r) => r.kind === "multi-root")!;
    expect(roots.ids).toEqual([1, 2]);
    expect(roots.verbs.filter((v) => v.kind === "role")).toMatchObject([
      { id: 1, role: "passive" },
      { id: 2, role: "passive" },
    ]);
    const loop = rows.fix.find((r) => r.kind === "loop-by-inference")!;
    expect(loop.verbs[0]).toMatchObject({
      kind: "verdict",
      key: "proximity:5:0|6:0",
      verdict: "ignore",
    });
    for (const row of rows.fix) expect(row.ids.length).toBeGreaterThan(0);
  });

  it("Check holds claims awaiting a verdict and Pea's proposals awaiting staging", () => {
    const doc = ductsRouteState.schema.parse({
      flows: { "30": { proposal: { value: { cfm: 150 } } }, "31": { staged: { value: { cfm: 90 } } } },
      rules: { "elbow:x": { proposal: { value: { table: "ED5-1" } } } },
    });
    const claims: Claim[] = [
      { id: "c1", state: "assumed", at: [1], text: "The unit is AHU-9." },
      { id: "c2", state: "proven", at: [2], text: "Answered.", verdict: "yes" },
    ];
    const rows = inboxRows({ ...base, doc, claims });
    expect(keys(rows.check)).toEqual(["claim:c1", "flows:30", "rules:elbow:x"]);
    const proposal = rows.check.find((r) => r.key === "flows:30")!;
    expect(proposal.status).toBe("Pea proposes 150 cfm");
    expect(proposal.verbs.map((v) => (v.kind === "stage" ? v.move : v.kind))).toEqual([
      "accept",
      "deny",
      "focus",
      "select",
    ]);
  });

  it("the Write row says what stands in the way, then what the preview holds", () => {
    expect(inboxRows(base).write.blocked).toBe("4 to fix and 2 to set before writing");
    expect(writeBlocked({ fix: 0, set: 1 })).toBe("1 to set before writing");
    expect(writeBlocked({ fix: 0, set: 0 })).toBeNull();
    const write = { staged: 3, hasPreview: true, fresh: true, planned: 3, refused: 0 };
    const clear = inboxRows({ ...base, findings: [], flows: new Map([[30, { cfm: 1 }], [31, { cfm: 1 }], [40, { cfm: 1 }]]), equipmentFlows: new Map([[1, { cfm: 1 }]]), write });
    expect(clear.write).toEqual({
      title: "Write 3 to Revit",
      status: "3 planned · 0 refused",
      blocked: null,
    });
    expect(inboxRows({ ...base, write: { ...write, fresh: false } }).write.status).toBe(
      "preview out of date",
    );
  });

  it("proximityIds reads the element ids out of an assumption key", () => {
    expect(proximityIds("proximity:12:0|34:1")).toEqual([12, 34]);
    expect(proximityIds("proximity:12:0|99")).toEqual([12, 99]);
  });
});
