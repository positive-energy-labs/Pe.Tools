import { type DuctFinding } from "@pe/agent-contracts";
import { describe, expect, it } from "vite-plus/test";

import type { HealPlan } from "@pe/ducts-domain/heal";
import type { SystemScope } from "@pe/ducts-domain/system-scope";

import {
  focusRow,
  stageIssues,
  issueAt,
  healRunView,
  inboxRows,
  type TriageInput,
} from "./inbox-rows";
import type { Claim } from "./legs";
import type { DuctsHealRun } from "./manifest";

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
  write: { staged: 0, hasPreview: false, fresh: false, planned: null, refused: null, esp: 0 },
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
        title: "Open ends 2.9″ apart: 12317607 ↔ 12317611",
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
  it("a no-fan row with exactly one unit offers to make it its system's fan, armed by a fresh preview", () => {
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
    const noFan = (fan?: TriageInput["fan"]) =>
      inboxRows({
        ...base,
        snapshot: fanless,
        roles,
        fan,
        nameOf: (id) => (id === 7 ? "FC-17" : String(id)),
      })
        .fix.find((r) => r.kind === "no-fan")!
        .verbs.filter((v) => v.kind === "preview");
    // One button: idle until a preview is held, its commit refused until then.
    expect(noFan()).toMatchObject([
      {
        on: { verb: "fan", unitId: 7, systemId: 19 },
        label: "preview: make FC-17 the fan of SA 19",
        held: null,
        stale: null,
        commit: { label: "make FC-17 the fan of SA 19", refusal: "Preview it first" },
      },
    ]);
    const response = { outcome: "planned", check: "SA 19: base equipment FC-17" } as never;
    const preview = { unitId: 7, systemId: 19, mode: "preview" as const, epoch: 3, response };
    expect(noFan({ run: preview, epoch: 3 })[0]).toMatchObject({
      held: {
        word: "make FC-17 the fan of SA 19 · previewed",
        summary: "SA 19: base equipment FC-17",
      },
      stale: null,
      commit: { refusal: null },
    });
    // The snapshot moved on: the held preview is dropped and the reason says so.
    expect(noFan({ run: preview, epoch: 4 })[0]).toMatchObject({
      held: null,
      stale: "changed since preview",
    });
    expect(noFan({ run: preview, epoch: 4 })[0]!.commit.refusal).toMatch(/snapshot changed/);
    const refused = {
      ...preview,
      response: { outcome: "refused", reason: "its port is in SA 18" } as never,
    };
    expect(noFan({ run: refused, epoch: 3 })[0]!.commit.refusal).toBe(
      "The preview refused: its port is in SA 18",
    );
    // An applied run is the outcome beside the Inputs button, not a held preview.
    expect(noFan({ run: { ...preview, mode: "apply" }, epoch: 3 })[0]).toMatchObject({
      held: null,
      outcome: "applied: SA 19: base equipment FC-17",
    });
    // A system that already has base equipment is never offered (the op refuses a swap).
    const based = { ...fanless, systems: [{ ...fanless.systems![0]!, baseEquipmentId: 8 }] };
    expect(
      inboxRows({ ...base, snapshot: based, roles })
        .fix.find((r) => r.kind === "no-fan")!
        .verbs.filter((v) => v.kind === "preview"),
    ).toEqual([]);
  });
});

describe("healing replaces the capped and connect verdicts", () => {
  // g1's open end 2:1 caps; the near-miss 5|6 is a coincident join; 7|8 and the anomalous 9|10 are a person's.
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
            covers: ["open-end:g1:2:1"],
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
    covered: new Set(["open-end:g1:2:1", "proximity:5:0|6:0"]),
    hard: new Map([
      [
        "proximity:7:0|8:0",
        "duct 7 and duct 8 differ in size: a transition. Fix it in Revit; its own tools enforce the rules its API does not.",
      ],
    ]),
  };

  it("a preview arms heal with what passed; an apply shows the group's ESP before and after, found again by its root", () => {
    const run: DuctsHealRun = {
      group: "g1",
      mode: "preview",
      epoch: 4,
      before: { esp: 0.3123, roots: [1], ids: [2, 5, 6] },
      response: {
        previewOnly: true,
        counts: { planned: 1, healed: 0, refused: 1 },
        groups: [
          {
            group: "g1",
            outcome: "planned",
            items: [
              {
                key: "cap:2:1",
                kind: "cap",
                how: "cap",
                outcome: "planned",
                created: [77],
                replaced: [],
              },
              {
                key: "join:5:0|6:0",
                kind: "join",
                how: "connect",
                outcome: "refused",
                reason: "post-check failed: the joint is 0.2 in open",
                created: [],
                replaced: [],
              },
            ],
            systemsBefore: [],
            systemsAfter: [],
          },
        ],
      },
    };
    const previewed = healRunView(run, snapshot, 4, () => null);
    expect(previewed).toMatchObject({ fresh: true, passed: ["cap:2:1"], esp: null });
    const row = inboxRows({ ...base, heal, healRun: previewed }).fix[0]!;
    expect(row.status).toBe("previewed: 1 pass · 1 refused");
    expect(row.verbs[0]).toMatchObject({
      kind: "preview",
      label: "preview heal",
      held: {
        word: "heal · previewed 1",
        summary: "1 pass · 1 refused",
        lines: [
          { key: "cap:2:1", state: "planned" },
          {
            key: "join:5:0|6:0",
            state: "refused",
            reason: "post-check failed: the joint is 0.2 in open",
          },
        ],
      },
      stale: null,
      commit: { label: "apply heal", refusal: null },
    });
    expect(row.note).toMatch(
      /Refused connect 5 to 6: post-check failed: the joint is 0\.2 in open\./,
    );
    expect(healRunView(run, snapshot, 5, () => null).fresh).toBe(false);
    // The snapshot moved on: the row's preview disarms with the reason.
    const moved = inboxRows({
      ...base,
      heal,
      healRun: healRunView(run, snapshot, 5, () => null),
    }).fix[0]!;
    expect(moved.verbs[0]).toMatchObject({ held: null, stale: "changed since preview" });

    // Revit renumbered the group: g1 is now g9, still holding root 1.
    const after = {
      ...snapshot,
      groups: [{ ...snapshot.groups[0]!, id: "g9" }, snapshot.groups[1]!],
    };
    const applied = healRunView(
      {
        ...run,
        mode: "apply",
        response: {
          ...run.response,
          previewOnly: false,
          counts: { planned: 0, healed: 1, refused: 0 },
        },
      },
      after,
      5,
      (g) => (g === "g9" ? 0.4051 : null),
    );
    expect(applied).toMatchObject({
      group: "g9",
      esp: { before: 0.3123, after: 0.4051 },
      ids: [77],
    });
    // A unit sits in every group its ports reach: a run whose group is still there never moves.
    const shared = {
      ...snapshot,
      groups: [
        { ...snapshot.groups[1]!, id: "g0", rootIds: snapshot.groups[0]!.rootIds },
        ...snapshot.groups,
      ],
    };
    expect(healRunView({ ...run, mode: "apply" }, shared, 5, () => null).group).toBe(run.group);
    const result = inboxRows({ ...base, snapshot: after, healRun: applied }).fix.find(
      (r) => r.key === "heal:g9",
    )!;
    expect(result).toMatchObject({
      title: "Healed g9",
      status: "healed 1 · ESP 0.312 → 0.405 in-wg",
      blocks: false,
    });
  });
  it("stage identities land on the exact row, including Heal folding and direct terminal input", () => {
    const rows = inboxRows({ ...base, heal });
    const issues = stageIssues(rows);
    const keys = new Set([...rows.fix, ...rows.set, ...rows.diagnostics].map((r) => r.key));
    for (const issue of issues) expect(focusRow(issue.key, keys)).toBe(issue.key);
    expect(issues.find((i) => i.key === "heal:g1")?.findings).toEqual(
      expect.arrayContaining(["open-end:g1:2:1", "proximity:5:0|6:0"]),
    );
    expect(issues.find((i) => i.key === "flows:30")?.blocking).toBe(true);
    expect(
      issues.filter((i) => rows.diagnostics.some((r) => r.key === i.key)).every((i) => !i.blocking),
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
