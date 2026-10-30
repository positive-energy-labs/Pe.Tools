import { type DuctFinding } from "@pe/agent-contracts";
import { describe, expect, it } from "vite-plus/test";

import type { HealPlan } from "@pe/ducts-domain/heal";
import type { SystemScope } from "@pe/ducts-domain/system-scope";

import {
  compactStatus,
  focusRow,
  stageIssues,
  issueAt,
  inboxRows,
  type TriageInput,
} from "./inbox-rows";
import type { Claim } from "./legs";

const node = (id: number, kind: string, groupId: string | null) =>
  ({
    id,
    kind,
    groupId,
    facts: [],
    connectors: [],
  }) as unknown as TriageInput["snapshot"]["nodes"][number];
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
  groups: [group("g1", [1], ["open-end:2:1"]), group("g2", [], [])],
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
  finding({ id: "open-end:2:1", kind: "open-end", elementIds: [2] }),
  finding({ id: "no-fan:g2", kind: "no-fan", groupId: "g2", elementIds: [40] }),
  finding({
    id: "proximity:5:0|6:0",
    kind: "joined-by-proximity",
    elementIds: [5, 6],
    grade: "near-miss",
  }),
  finding({
    id: "proximity:7:0|8:0",
    kind: "joined-by-proximity",
    elementIds: [7, 8],
    grade: "stretched",
  }),
  finding({
    id: "proximity:9:0|10:0",
    kind: "joined-by-proximity",
    elementIds: [9, 10],
    grade: "anomalous",
  }),
  finding({
    id: "catalog:catalog-missing-table:31",
    kind: "catalog-missing-table",
    elementIds: [31],
  }),
  finding({ id: "flow:no-flow:30", kind: "no-flow", elementIds: [30], clearer: "pea" }),
  finding({ id: "stub:g1:3", kind: "stub", elementIds: [3] }),
];
const base = {
  snapshot,
  scope: null as SystemScope | null,
  findings,
  flows: new Map<number, { cfm: number | null }>([
    [30, { cfm: null }],
    [31, { cfm: 120 }],
    [40, { cfm: null }],
  ]),
  equipmentFlows: new Map<number, { cfm: number | null }>([[1, { cfm: null }]]),
  doc: null,
  claims: [] as Claim[],
  write: { edit: 0, esp: 0 },
};

describe("the ducts inbox", () => {
  it("a possible missed join is non-blocking Diagnostics with its measured gap and select verb", () => {
    const rows = inboxRows({
      ...base,
      findings: [
        finding({
          id: "missed-join:12317607:0|12317611:0",
          kind: "missed-join",
          elementIds: [12317607, 12317611],
          connectors: ["12317607:0", "12317611:0"],
          gapIn: 2.88,
        }),
      ],
    });
    expect(rows.fix).toEqual([]);
    expect(rows.diagnostics).toMatchObject([
      {
        kind: "missed-join",
        title: "Open ends at unnamed element and unnamed element",
        verbs: [{ kind: "select", ids: [12317607, 12317611] }],
      },
    ]);
  });
  it("a fitting no rule prices is a Diagnostics row with a verb to state its drop, never a holding Fix row", () => {
    const rows = inboxRows({
      ...base,
      findings: [finding({ id: "no-rule:Flex Connector", kind: "no-rule", elementIds: [3] })],
    });
    expect(rows.fix).toEqual([]);
    expect(rows.diagnostics).toMatchObject([
      {
        kind: "no-rule",
        verbs: [{ kind: "focus", cell: { segment: "componentDrops", id: 3 } }, { kind: "select" }],
      },
    ]);
  });
  it("a no-fan row with exactly one unit offers to make it its system's fan, places one reviewed kernel command", () => {
    const unit = {
      ...node(7, "equipment", null),
      connectors: [{ index: 1, classification: "SupplyAir" }],
    } as unknown as TriageInput["snapshot"]["nodes"][number];
    const fanless = {
      ...snapshot,
      groups: [{ ...group("g2", [7]), systemNames: ["SA 19"] }],
      nodes: [...snapshot.nodes, unit],
      systems: [
        { id: 19, name: "SA 19", classification: "SupplyAir", baseEquipmentId: null },
      ] as TriageInput["snapshot"]["systems"],
    };
    const roles = new Map([[7, { role: "passive" as const, why: "proposed", reason: "x" }]]);
    const noFan = () =>
      inboxRows({
        ...base,
        snapshot: fanless,
        roles,
        nameOf: (id) => (id === 7 ? "FC-17" : String(id)),
      })
        .fix.find((r) => r.kind === "no-fan")!
        .verbs.filter((v) => v.kind === "command");
    expect(noFan()[0]).toMatchObject({
      kind: "command",
      on: { verb: "fan", unitId: 7, systemId: 19 },
      label: "make FC-17 the fan of SA 19",
    });
  });

  const heal: HealPlan = {
    groups: [
      {
        group: "g1",
        items: [
          {
            key: "cap:2:1",
            kind: "cap",
            how: "cap",
            end: "2:1",
            gapIn: 0,
            ids: [2],
            covers: ["open-end:2:1"],
          },
          {
            key: "join:5:0|6:0",
            kind: "join",
            how: "connect",
            end: "5:0",
            other: "6:0",
            gapIn: 0,
            ids: [5, 6],
            covers: ["proximity:5:0|6:0"],
          },
        ],
      },
    ],
    covered: new Set(["open-end:2:1", "proximity:5:0|6:0"]),
    hard: new Map([
      [
        "proximity:7:0|8:0",
        {
          ids: [7, 8],
          covers: ["proximity:7:0|8:0"],
          note: "Ducts differ in size: a transition. Fix it in Revit.",
        },
      ],
    ]),
  };

  it("stage identities land on the exact row, including Heal folding and direct terminal input", () => {
    const rows = inboxRows({ ...base, heal });
    const issues = stageIssues(rows);
    const keys = new Set(
      [...rows.fix, ...rows.set, ...rows.check, ...rows.diagnostics].map((r) => r.key),
    );
    for (const issue of issues) expect(focusRow(issue.key, keys)).toBe(issue.key);
    expect(issues.find((i) => i.key === "heal:g1")?.findings).toEqual(
      expect.arrayContaining(["open-end:2:1", "proximity:5:0|6:0"]),
    );
    expect(issues.find((i) => i.key === "flows:30")?.damage).toBeTruthy();
    expect(
      issues.filter((i) => rows.diagnostics.some((r) => r.key === i.key)).every((i) => !i.damage),
    ).toBe(true);
    const flow = issues.find((i) => i.key === "flows:30")!;
    const picker = { ...flow, key: "airflow", ids: [30, 31] };
    expect(issueAt([picker, flow], [30])?.key).toBe("flows:30");
    expect(issueAt([picker, flow], [30], "airflow")?.key).toBe("airflow");
  });
});

it("a no-rule finding offers one price-as pick per named family", () => {
  const radius = { ...node(55, "fitting", "g1"), family: "Radius Elbow" };
  const rows = inboxRows({
    ...base,
    snapshot: { ...snapshot, nodes: [radius] },
    findings: [finding({ id: "no-rule:Radius Elbow", kind: "no-rule", elementIds: [55] })],
  });
  expect(rows.diagnostics[0]?.verbs).toContainEqual({ kind: "price-as", family: "Radius Elbow" });
});

it("compacts a status for the closed row and keeps unknown words", () => {
  expect(compactStatus("0 of 6 units read")).toBe("0/6 read");
  expect(compactStatus("3 of 12 terminals read")).toBe("3/12 read");
  expect(compactStatus("outside priced paths")).toBe("off path");
  expect(compactStatus("no flow · not on SA 19's runs")).toBe("no flow");
  expect(compactStatus("healed 3 · ESP 0.100 → 0.200 in-wg")).toBe("healed 3");
  expect(compactStatus("stretched")).toBe("stretched");
});
