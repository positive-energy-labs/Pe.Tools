import { describe, expect, it } from "vite-plus/test";
import { ductsRouteState, type DuctFinding } from "@pe/agent-contracts";

import type { HealPlan } from "@pe/ducts-domain/heal";
import type { SystemScope } from "@pe/ducts-domain/system-scope";
import { unitFlowsIn } from "@pe/ducts-domain/survey";

import {
  annotatedFindings,
  diagnosticsKey,
  healRunView,
  inboxRows,
  proximityIds,
  espWaits,
  type InboxItem,
  type TriageInput,
} from "./inbox-rows";
import type { DuctsHealRun } from "./manifest";
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
const keys = (items: readonly InboxItem[]) => items.map((i) => i.key);
/** A system's scope as `systemScope` reads it, stated by hand: every group it is in prices it. */
const system = (
  name: string,
  groups: string[],
  ids: { terminals?: number[]; units?: number[]; prices?: number[]; members?: number[] },
): SystemScope => ({
  name,
  groups,
  pricing: new Set(groups),
  shared: new Map(),
  terminals: new Set(ids.terminals),
  units: new Set(ids.units),
  prices: new Set(ids.prices),
  members: new Set(ids.members),
});

describe("a staged verdict is a ruling, not a Revit write", () => {
  const doc = ductsRouteState.schema.parse({
    assumptions: {
      "open-end:g1:2:1": { staged: { value: { kind: "verdict", verdict: "capped" } } },
    },
  });
  it("a capped open end leaves Fix for Diagnostics with its take-back", () => {
    const rows = inboxRows({ ...base, doc });
    expect(keys(rows.fix)).not.toContain("open-end:g1:2:1");
    const ruled = rows.diagnostics.find((r) => r.key === "open-end:g1:2:1")!;
    expect(ruled.status).toBe("ruled: capped");
    expect(ruled.verbs[0]).toMatchObject({
      kind: "verdict",
      verdict: "capped",
      on: true,
      label: "take back",
    });
  });
  it("a pending ruling is a write to the model's store, previewed like any other", () => {
    const rows = inboxRows({ ...base, doc, write: { ...base.write, staged: 2 } });
    expect(rows.write.status).toBe("not previewed");
    expect(inboxRows(base).write.status).toBe("nothing staged");
  });
});

describe("the airflow read slot", () => {
  const airflow = {
    current: "PE_M_Grd_AirFlow",
    options: [
      { slot: "Flow", label: "Flow · instance", have: 1, of: 2 },
      { slot: "PE_M_Grd_AirFlow", label: "PE_M_Grd_AirFlow · instance, shared", have: 0, of: 2 },
    ],
  };
  it("asks first, while a terminal reads no flow, with every candidate's coverage", () => {
    const rows = inboxRows({ ...base, airflow });
    expect(keys(rows.set)).toEqual(["airflow", "flows:30", "equipmentFlows:1"]);
    const row = rows.set[0]!;
    expect(row.title).toBe("Airflow from PE_M_Grd_AirFlow");
    expect(row.status).toBe("0 of 2 terminals read");
    expect(row.ids).toEqual([30]);
    expect(row.verbs[0]).toMatchObject({ kind: "airflow", current: "PE_M_Grd_AirFlow" });
  });
  it("is gone once every terminal reads a flow", () => {
    const flows = new Map<number, { cfm: number | null }>([
      [30, { cfm: 90 }],
      [31, { cfm: 120 }],
    ]);
    expect(keys(inboxRows({ ...base, flows, airflow }).set)).toEqual(["equipmentFlows:1"]);
  });
  it("asks for the unit airflow slot ahead of the units with no flow, never for a passive one", () => {
    const unitAirflow = {
      current: "PE_M_Fan_AirFlowDesign",
      options: [{ slot: "Airflow", label: "Airflow · type", have: 1, of: 1 }],
    };
    const rows = inboxRows({ ...base, airflow, unitAirflow });
    expect(keys(rows.set)).toEqual(["airflow", "flows:30", "unit-airflow", "equipmentFlows:1"]);
    expect(rows.set[2]!.verbs[0]).toMatchObject({ kind: "airflow", of: "unit" });
    const passive = inboxRows({
      ...base,
      unitAirflow,
      roles: new Map([[1, { role: "passive", why: "proposed", reason: "states no design flow" }]]),
    });
    expect(keys(passive.set)).not.toContain("unit-airflow");
  });
});

describe("the ducts inbox", () => {
  it("a loop modelled in Revit is a diagnostic priced as a tree, never a Fix row", () => {
    const rows = inboxRows({
      ...base,
      findings: [finding({ id: "loop:g1:2", kind: "loop", groupId: "g1", elementIds: [2] })],
    });
    expect(rows.fix.map((r) => r.key)).not.toContain("loop:g1:2");
    expect(rows.diagnostics.find((r) => r.key === "loop:g1:2")).toMatchObject({
      status: "priced as a tree",
    });
  });

  it("puts blocking findings under Fix, inputs under Set and bridged joins under Diagnostics", () => {
    const rows = inboxRows(base);
    expect(keys(rows.fix)).toEqual(["open-end:g1:2:1", "no-fan:g2", "proximity:9:0|10:0"]);
    // Terminal 30 has no flow; 40 sits in a group with no fan, so only its Fix row stands.
    expect(keys(rows.set)).toEqual(["flows:30", "equipmentFlows:1"]);
    expect(keys(rows.diagnostics)).toEqual([
      "proximity:5:0|6:0",
      "proximity:7:0|8:0",
      "catalog:catalog-missing-table:31",
    ]);
    // The advisory stub and the no-flow finding (a Set row now) make no row of their own.
    expect(keys([...rows.fix, ...rows.set, ...rows.diagnostics])).not.toContain("stub:g1:3");
  });

  it("scopes to the chosen system's groups, no-fan by its group id", () => {
    const sa2 = inboxRows({
      ...base,
      scope: system("SA 2", ["g2"], { terminals: [40], prices: [40], members: [40] }),
    });
    expect(keys(sa2.fix)).toEqual(["no-fan:g2"]);
    expect(sa2.set).toEqual([]);
    const sa1 = inboxRows({
      ...base,
      scope: system("SA 1", ["g1"], {
        terminals: [30, 31],
        units: [1],
        prices: [1, 2, 30, 31],
        members: [1, 2, 30, 31],
      }),
    });
    expect(keys(sa1.fix)).toEqual(["open-end:g1:2:1"]);
    expect(keys(sa1.set)).toEqual(["flows:30", "equipmentFlows:1"]);
  });

  it("in a shared group only the runs that price the system block; the rest is Diagnostics", () => {
    // g1 also carries RA 1: its grille 31 and the open end at 2 are on RA 1's runs, not SA 1's.
    const rows = inboxRows({
      ...base,
      flows: new Map([...base.flows, [31, { cfm: null }]]),
      write: { ...base.write, esp: 1 },
      scope: system("SA 1", ["g1"], {
        terminals: [30],
        units: [1],
        prices: [1, 30],
        members: [1, 2, 30, 31],
      }),
    });
    expect(keys(rows.fix)).toEqual([]);
    expect(keys(rows.set)).toEqual(["flows:30", "equipmentFlows:1"]);
    const open = rows.diagnostics.find((r) => r.key === "open-end:g1:2:1")!;
    expect(open.status).toBe("fix in Revit · not on SA 1's runs");
    expect(open.tone).toBeUndefined();
    const others = rows.diagnostics.find((r) => r.key === "flows:other-systems")!;
    expect(others.ids).toEqual([31]);
    expect(rows.write.held).toBe(
      "1 staged ESP left out of this write: 2 to set before the ESP writes",
    );
  });

  it("every row outside Diagnostics has a verb; Set rows deep-link to their cell", () => {
    const rows = inboxRows(base);
    for (const row of [...rows.fix, ...rows.set, ...rows.check])
      expect(row.verbs.length).toBeGreaterThan(0);
    const flow = rows.set[0]!.verbs.find((v) => v.kind === "focus");
    expect(flow).toMatchObject({ kind: "focus", cell: { segment: "flows", id: 30 } });
    const catalog = rows.diagnostics.find((r) => r.kind === "catalog-missing-table")!;
    expect(catalog.verbs[0]).toMatchObject({
      kind: "focus",
      cell: { segment: "terminalDrops", id: 31 },
    });
  });

  it("an objection stages the proximity ignore verdict and stays in Diagnostics with its take-back, never in Fix", () => {
    const object = inboxRows(base).diagnostics[0]!.verbs[0]!;
    expect(object).toMatchObject({
      kind: "verdict",
      verdict: "ignore",
      label: "object",
      on: false,
    });
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

  it("several fans priced per fan is a Diagnostics line, never a Fix", () => {
    const rows = inboxRows({
      ...base,
      findings: [
        finding({
          id: "multi-fan:g1",
          kind: "multi-fan",
          groupId: "g1",
          elementIds: [1, 2],
          note: "priced per fan: FC-30 601 cfm (sum of 9 grilles) owns the trunk",
        }),
      ],
    });
    expect(rows.fix.map((r) => r.kind)).not.toContain("multi-fan");
    const split = rows.diagnostics.find((r) => r.kind === "multi-fan")!;
    expect(split).toMatchObject({ status: "priced per fan", ids: [1, 2] });
    expect(split.note).toContain("owns the trunk");
  });

  it("several fans offers to rule each proposed fan, or each as passive; a loop offers to break its inferred join", () => {
    const rows = inboxRows({
      ...base,
      roles: new Map([
        [1, { role: "fan", why: "proposed", reason: "states a design flow of 800 cfm" }],
        [2, { role: "fan", why: "ruled", reason: "ruled in the model" }],
      ]),
      findings: [
        finding({ id: "multi-root:g1", kind: "multi-root", groupId: "g1", elementIds: [1, 2] }),
        finding({ id: "loop-by-inference:5:0|6:0", kind: "loop-by-inference", elementIds: [5, 6] }),
      ],
    });
    const roots = rows.fix.find((r) => r.kind === "multi-root")!;
    expect(roots.ids).toEqual([1, 2]);
    expect(roots.verbs.filter((v) => v.kind === "role")).toMatchObject([
      { id: 1, role: "fan" },
      { id: 1, role: "passive" },
      { id: 2, role: "passive" },
    ]);
    expect(roots.note).toContain("states a design flow of 800 cfm");
    const loop = rows.fix.find((r) => r.kind === "loop-by-inference")!;
    expect(loop.verbs[0]).toMatchObject({
      kind: "verdict",
      key: "proximity:5:0|6:0",
      verdict: "ignore",
    });
    for (const row of rows.fix) expect(row.ids.length).toBeGreaterThan(0);
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
        .verbs.filter((v) => v.kind === "fan");
    expect(noFan()).toMatchObject([
      { mode: "preview", unitId: 7, systemId: 19, label: "preview: make FC-17 the fan of SA 19" },
      { mode: "apply", label: "make FC-17 the fan of SA 19", refusal: "Preview it first" },
    ]);
    const response = { outcome: "planned", check: "SA 19: base equipment FC-17" } as never;
    const preview = { unitId: 7, systemId: 19, mode: "preview" as const, epoch: 3, response };
    expect(noFan({ run: preview, epoch: 3 })[1]).toMatchObject({
      refusal: null,
      outcome: "previewed: SA 19: base equipment FC-17",
    });
    expect(noFan({ run: preview, epoch: 4 })[1]!.refusal).toMatch(/snapshot changed/);
    const refused = {
      ...preview,
      response: { outcome: "refused", reason: "its port is in SA 18" } as never,
    };
    expect(noFan({ run: refused, epoch: 3 })[1]!.refusal).toBe(
      "The preview refused: its port is in SA 18",
    );
    // A system that already has base equipment is never offered (the op refuses a swap).
    const based = { ...fanless, systems: [{ ...fanless.systems![0]!, baseEquipmentId: 8 }] };
    expect(
      inboxRows({ ...base, snapshot: based, roles })
        .fix.find((r) => r.kind === "no-fan")!
        .verbs.filter((v) => v.kind === "fan"),
    ).toEqual([]);
  });

  it("Check holds claims awaiting a verdict and Pea's proposals awaiting staging", () => {
    const doc = ductsRouteState.schema.parse({
      flows: {
        "30": { proposal: { value: { cfm: 150 } } },
        "31": { staged: { value: { cfm: 90 } } },
      },
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

  it("Fix and Set rows hold back only the staged ESP; the rest of the write stands", () => {
    // Nothing staged holds nothing back: Fix and Set never stand between a ruling and the write.
    expect(inboxRows(base).write.held).toBeNull();
    const fresh = { staged: 3, hasPreview: true, fresh: true, planned: 2, refused: 0 };
    expect(inboxRows({ ...base, write: { ...fresh, esp: 1 } }).write).toEqual({
      title: "Write 2 to Revit",
      status: "2 planned · 0 refused · ESP held",
      held: "1 staged ESP left out of this write: 3 to fix and 2 to set before the ESP writes",
    });
    expect(espWaits({ fix: 0, set: 1 })).toBe("1 to set before the ESP writes");
    expect(espWaits({ fix: 0, set: 0 })).toBeNull();
  });

  it("the Write row says what the preview holds", () => {
    const write = { staged: 3, hasPreview: true, fresh: true, planned: 3, refused: 0, esp: 0 };
    const clear = inboxRows({
      ...base,
      findings: [],
      flows: new Map([
        [30, { cfm: 1 }],
        [31, { cfm: 1 }],
        [40, { cfm: 1 }],
      ]),
      equipmentFlows: new Map([[1, { cfm: 1 }]]),
      write,
    });
    expect(clear.write).toEqual({
      title: "Write 3 to Revit",
      status: "3 planned · 0 refused",
      held: null,
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

  it("one Heal row per group leads Fix, listing its caps and joins; what it covers makes no row of its own", () => {
    const rows = inboxRows({
      ...base,
      heal,
      nameOf: (id) => `duct ${id}`,
      groupLabel: () => "SA 1",
    });
    expect(keys(rows.fix)).toEqual(["heal:g1", "no-fan:g2", "proximity:9:0|10:0"]);
    const row = rows.fix[0]!;
    expect(row).toMatchObject({
      kind: "heal",
      title: "Heal SA 1: 1 cap · 1 join",
      status: "not previewed",
      tone: "alarm",
    });
    expect(row.note).toMatch(/^cap duct 2 \(end 1\); connect duct 5 to duct 6\./);
    expect(row.verbs.map((v) => (v.kind === "heal" ? v.mode : v.kind))).toEqual([
      "preview",
      "apply",
      "select",
    ]);
    expect(row.verbs[1]).toMatchObject({ refusal: "Preview the heal first" });
    expect(keys(rows.diagnostics)).not.toContain("proximity:5:0|6:0");
    // A bridged join heal cannot make is still a diagnostic, its note saying whose repair it is.
    expect(rows.diagnostics.find((r) => r.key === "proximity:7:0|8:0")!.note).toMatch(
      /a transition\. Fix it in Revit/,
    );
  });

  it("no row offers capped or connect: an open end left over and an anomalous join are fixed in Revit", () => {
    const rows = inboxRows(base);
    const verbs = [...rows.fix, ...rows.diagnostics].flatMap((r) => r.verbs);
    expect(
      verbs.some(
        (v) => v.kind === "verdict" && (v.verdict === "capped" || v.verdict === "connect"),
      ),
    ).toBe(false);
    const end = rows.fix.find((r) => r.key === "open-end:g1:2:1")!;
    expect(end.status).toBe("fix in Revit");
    expect(end.verbs.map((v) => v.kind)).toEqual(["select", "verdict"]);
    expect(
      rows.fix
        .find((r) => r.key === "proximity:9:0|10:0")!
        .verbs.map((v) => (v.kind === "verdict" ? v.verdict : v.kind)),
    ).toEqual(["select", "ignore"]);
  });

  it("a Heal row covering only bridged joins does not hold the ESP", () => {
    const joinsOnly: HealPlan = {
      ...heal,
      groups: [{ group: "g1", items: [heal.groups[0]!.items[1]!] }],
      covered: new Set(["proximity:5:0|6:0"]),
    };
    const rows = inboxRows({ ...base, heal: joinsOnly, write: { ...base.write, esp: 1 } });
    expect(rows.fix[0]).toMatchObject({ key: "heal:g1", blocks: false });
    // open-end, no-fan, anomalous: the Heal row is not counted.
    expect(rows.write.held).toBe(
      "1 staged ESP left out of this write: 3 to fix and 2 to set before the ESP writes",
    );
  });

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
    expect(row.verbs[1]).toMatchObject({ label: "heal 1", refusal: null });
    expect(row.note).toMatch(
      /Refused connect 5 to 6: post-check failed: the joint is 0\.2 in open\./,
    );
    expect(healRunView(run, snapshot, 5, () => null).fresh).toBe(false);

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
});

describe("a unit's flow in the open system", () => {
  // DH-21 (SA 19, Project A) reads 768 cfm from another system's grilles and serves none of g1's.
  const surveyed = {
    equipmentFlows: new Map([[1, { cfm: 768, source: "derived" as const, grilles: 2 }]]),
    fanFlows: new Map([["g1", new Map([[1, { cfm: null, source: null }]])]]),
  };
  it("asks for a design flow when the system's own groups give it none, as its fan row says no cfm", () => {
    const rows = inboxRows({ ...base, equipmentFlows: unitFlowsIn(surveyed, ["g1"]) });
    expect(keys(rows.set)).toContain("equipmentFlows:1");
  });
  it("reads the document-wide flow only with no system open", () => {
    const rows = inboxRows({ ...base, equipmentFlows: unitFlowsIn(surveyed, null) });
    expect(keys(rows.set)).not.toContain("equipmentFlows:1");
  });
});

describe("the Diagnostics key and the picture's annotations", () => {
  const rows = inboxRows(base);
  it("keys each Diagnostics row by its kind, a bridged join by its grade, with counts", () => {
    const key = diagnosticsKey(rows.diagnostics);
    expect(key).toContainEqual({ kind: "near-miss", count: 1 });
    expect(key).toContainEqual({ kind: "stretched", count: 1 });
    expect(key).toContainEqual({ kind: "catalog-missing-table", count: 1 });
    expect(key.reduce((n, k) => n + k.count, 0)).toBe(rows.diagnostics.length);
  });
  it("with no kind picked annotates the Fix rows only; a picked kind annotates its Diagnostics rows", () => {
    const fix = annotatedFindings(rows, null, "");
    expect(fix).toContain("open-end:g1:2:1");
    expect(fix).toContain("proximity:9:0|10:0");
    expect(fix).not.toContain("proximity:5:0|6:0");
    expect([...annotatedFindings(rows, null, "near-miss")]).toEqual(["proximity:5:0|6:0"]);
  });
  it("a Heal row stands for the findings it covers", () => {
    const heal = {
      groups: [{ group: "g1", items: [{ key: "cap", ids: [2], covers: ["open-end:g1:2:1"] }] }],
      covered: new Set(["open-end:g1:2:1"]),
      hard: new Map(),
    } as unknown as HealPlan;
    const healed = inboxRows({ ...base, heal });
    expect(keys(healed.fix)).toContain("heal:g1");
    expect(annotatedFindings(healed, heal, "")).toContain("open-end:g1:2:1");
  });
});
