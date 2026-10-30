/**
 * The inputs pane kaitpw distrusted on cloud Chadds MUAS-1 (2026-10-30; reconstruction in
 * Pe.Tools/.artifacts/tmp/inputs-trust/reconstruction.md): kind rows by raw key and per instance,
 * fittings ungrouped with mechanism-echo descriptions, rows that vanished when cleared, no undo.
 */
import { expect, it } from "vite-plus/test";
import {
  ductsInputsSchema,
  ductsSheetEditsSchema,
  type DuctsInputs,
  type FittingPricing,
  type Resolved,
} from "@pe/agent-contracts";
import { editCells } from "@pe/ducts-domain/sheet/index";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { fittingGroups, tableMeaning } from "./fitting-groups";
import { cellsAt, effectWords, restorePatches } from "./input-history";
import { inputRows } from "./input-rows";
import { kindMeaning } from "./kind-meaning";

type Node = DuctSnapshot["nodes"][number];
const firm = <T>(value: T): Resolved<T> => ({ value, source: "firm", ref: "seed" });
const inputs = (extra: Partial<DuctsInputs> = {}): DuctsInputs =>
  ductsInputsSchema.parse({
    criteria: {
      velocityLimitFpm: { supply: firm(900), return: firm(700) },
      terminalDropInWg: firm(0.03),
      autoJoinGapIn: firm(3),
      healBoxIn: firm(36),
      splitPolicy: firm("even"),
      allowanceInWg: { supply: firm(0), return: firm(0) },
    },
    terminals: {},
    units: {},
    components: {},
    tables: {},
    assignments: {},
    fittingDrops: {},
    rulings: { joins: [], ends: [] },
    ...extra,
  });
const port = (index: number, direction: "in" | "out", classification: string) =>
  ({
    index,
    direction,
    classification,
    kind: "end",
    point: [0, 0, 0],
    connectedTo: null,
  }) as unknown as Node["connectors"][number];
// Broan B160E75RT as Chadds models it: supply and exhaust outlets, supply and exhaust inlets.
const erv = (id: number): Node =>
  ({
    id,
    kind: "equipment",
    category: "Mechanical Equipment",
    family: "Broan_B160E75RT_ERV_R25",
    type: "B160E75RT",
    point: [0, 0, 0],
    facts: [{ key: "mark", text: `RV-${id}` }],
    connectors: [
      port(2, "out", "SupplyAir"),
      port(3, "out", "ExhaustAir"),
      port(1, "in", "ExhaustAir"),
      port(4, "in", "SupplyAir"),
    ],
  }) as unknown as Node;
const unit = (kind: "erv" | "air-handler", source: "typed" | "suggested") => ({
  kind: { value: kind, source, ...(source === "suggested" ? { ref: "name" } : {}) },
  role: { value: "fan" as const, source: "suggested" as const, ref: "name" },
  cfm: { value: 35, source: "revit" as const, ref: "PE_M_Fan_AirFlow" },
  esp: { value: null, source: "none" as const },
});
const KEY = JSON.stringify(["Broan_B160E75RT_ERV_R25", "B160E75RT"]);

it("a unit kind is one row per family and type, named by family and type and the units it covers", () => {
  // r22 drew four rows each labelled ["Broan_B160E75RT_ERV_R25","B160E… (the raw Work key).
  const ids = [6105264, 6953852, 6104810, 12806600];
  const rows = inputRows({
    snapshot: { nodes: ids.map(erv) },
    doc: null,
    inputs: inputs({
      units: Object.fromEntries(ids.map((id) => [id, unit("air-handler", "typed")])),
    }),
    fanUnitId: null,
  }).filter((r) => r.label === "Unit kind");
  expect(rows).toHaveLength(1);
  const sorted = [...ids].sort((a, b) => a - b);
  expect(rows[0]).toMatchObject({
    title: "Broan_B160E75RT_ERV_R25 · B160E75RT",
    ids: sorted,
    typed: true,
    clear: { kinds: { [KEY]: null } },
  });
  expect(JSON.stringify(rows[0]!.subject)).not.toContain('[\\"Broan');
  expect(rows[0]!.subject.filter((p) => typeof p !== "string")).toEqual(
    sorted.map((id) => ({ id })),
  );
});

it("each kind option says what it means for this unit's ports, role and flow", () => {
  const node = erv(6105264);
  const u = unit("erv", "suggested");
  expect(kindMeaning(node, "erv", u)).toBe(
    "fan: supply out c2 from supply in c4; exhaust out c3 from exhaust in c1 · flow 35 cfm (revit PE_M_Fan_AirFlow)",
  );
  // The r22 choice: an air handler takes one outlet, so this unit loses its fan ports.
  expect(kindMeaning(node, "air-handler", u)).toMatch(
    /^no fan port: 2 outlets \(supply out c2, exhaust out c3\)/,
  );
  expect(kindMeaning(node, "other", u)).toMatch(/^passive: adds its drop and moves no air/);
});

it("a row stays when its value is not typed, carrying the source underneath and no clear", () => {
  const rows = inputRows({
    snapshot: { nodes: [] },
    doc: null,
    inputs: inputs({
      terminals: {
        7: { cfm: { value: 1120, source: "revit", ref: "Flow" }, drop: firm(0.03) },
        8: { cfm: { value: 150, source: "typed" }, drop: firm(0.03) },
      },
    }),
    fanUnitId: null,
  });
  expect(rows.find((r) => r.key === "terminal:7:cfm")).toMatchObject({
    source: "revit Flow",
    typed: false,
    clear: null,
  });
  const typed = rows.find((r) => r.key === "terminal:8:cfm")!;
  expect(typed).toMatchObject({ typed: true, clear: { flows: { 8: null } } });
  if (typed.control.kind !== "number") throw new Error("number row");
  expect(ductsSheetEditsSchema.parse(typed.control.edit(160))).toEqual({
    flows: { 8: { cfm: 160 } },
  });
});

const fitting = (key: number, extra: Partial<FittingPricing>): FittingPricing =>
  ({
    key: String(key),
    elementId: key,
    family: "Round Elbow",
    rule: "elbow-1d-le10",
    table: "CD3-2",
    ruleSource: "matched",
    tableSource: "default",
    options: ["CD3-2", "CD3-21"],
    candidates: [],
    lossInWg: 0.001,
    unpriced: null,
    typed: null,
    ...extra,
  }) as FittingPricing;
const TITLES = {
  "CD3-2": "CD3-2  Elbow, Die Stamped, 90 Degree, r/D = 1 (UMC 1985, Report SRF785)",
  "CD3-21": "CD3-21  Elbow, Round, 5 Gore, 90 Degree (Idelchik 1986)",
};

it("fittings group by rule: one header with the rule's name, table meaning and picker; members under it", () => {
  const groups = fittingGroups([fitting(1, {}), fitting(2, {}), fitting(3, {})], inputs(), TITLES);
  expect(groups).toHaveLength(1);
  const [g] = groups;
  expect(g).toMatchObject({
    key: "rule:elbow-1d-le10",
    title: "Round Elbow 1 D · D ≤ 10 in",
    table: "CD3-2",
    tableMeaning: "Elbow, Die Stamped, 90 Degree, r/D = 1",
    source: "default",
    clear: null,
  });
  expect(g!.members.map((m) => m.ids)).toEqual([[1], [2], [3]]);
  expect(g!.lossInWg).toBeCloseTo(0.003, 9);
  const other = g!.choices.find((c) => c.key === "CD3-21")!;
  expect(other.sub).toBe(
    "Elbow, Round, 5 Gore, 90 Degree · every fitting this rule matches in the document",
  );
  expect(other.edits).toEqual({ tables: { "elbow-1d-le10": { table: "CD3-21" } } });
});

it("picking the rule's own table over a typed choice clears it instead of typing the default", () => {
  // r16 wrote "typed CD3-2" (the default), which changed nothing and read as a person's choice.
  const typedIn = inputs({ tables: { "elbow-1d-le10": { value: "CD3-21", source: "typed" } } });
  const [g] = fittingGroups(
    [fitting(1, { table: "CD3-21", tableSource: "typed" })],
    typedIn,
    TITLES,
  );
  expect(g!.source).toBe("typed");
  expect(g!.choices.find((c) => c.key === "CD3-2")!.edits).toEqual({
    tables: { "elbow-1d-le10": null },
  });
  expect(g!.choices.find((c) => c.key === "CD3-21")).toMatchObject({ current: true, edits: null });
  expect(g!.clear).toEqual({ tables: { "elbow-1d-le10": null } });
});

it("unmatched fittings group by family, and a choice in Work no fitting of this fan reads keeps its header", () => {
  const unmatched = fitting(9, {
    rule: null,
    table: null,
    ruleSource: "none",
    tableSource: null,
    options: [],
    lossInWg: null,
    unpriced: "no rule matches",
    candidates: [
      {
        rule: "elbow-15d-45-le10",
        words: "Round Elbow 1.5 D die stamped · 45 degrees",
        tables: ["CD3-3"],
      },
    ],
  });
  const groups = fittingGroups(
    [unmatched],
    inputs({ tables: { "trx-round": { value: "SD4-1", source: "typed" } } }),
    TITLES,
  );
  expect(groups.map((g) => [g.key, g.members.length, g.source])).toEqual([
    ["family:Round Elbow", 1, "not priced"],
    ["rule:trx-round", 0, "typed"],
  ]);
  expect(groups[0]!.choices[0]!.edits).toEqual({
    assignments: { "Round Elbow": { rule: "elbow-15d-45-le10" } },
  });
  expect(groups[1]!.clear).toEqual({ tables: { "trx-round": null } });
});

it("ASHRAE titles read as the fitting, without the id and the source", () => {
  expect(tableMeaning("CD3-21", TITLES)).toBe("Elbow, Round, 5 Gore, 90 Degree");
  expect(tableMeaning("CD3-9", TITLES)).toBeNull();
});

it("undo restores the exact Work cells an edit wrote, a cell that did not exist by deleting it", () => {
  const edits = {
    kinds: { [KEY]: { kind: "air-handler" as const } },
    tables: { "elbow-1d-le10": null },
  };
  const cells = editCells(edits);
  expect(cells).toEqual([
    ["kinds", KEY],
    ["rules", "elbow-1d-le10"],
  ]);
  const before = {
    kinds: {},
    rules: { "elbow-1d-le10": { edit: { value: { table: "CD3-21" }, by: "human" } } },
  };
  const saved = cellsAt(before, cells);
  expect(restorePatches(cells, saved)).toEqual([
    { path: ["kinds", KEY] },
    {
      path: ["rules", "elbow-1d-le10"],
      value: { edit: { value: { table: "CD3-21" }, by: "human" } },
    },
  ]);
});

it("an edit's effect reads before → after on what moved, ≥ marking an incomplete side's known subtotal", () => {
  const side = (worstPath: number | null, knownInWg: number, complete: boolean) => ({
    worstPath,
    knownInWg,
    complete,
    assumedInWg: null,
    allowanceInWg: 0,
    telFt: 0,
    frictionRatePer100: null,
  });
  const r14 = {
    supply: side(null, 0.028054, false),
    return: side(0.046875, 0.046875, true),
    requiredEspInWg: null,
    requiredEspAssumedInWg: null,
  };
  const r20 = {
    supply: side(null, 0.016504, false),
    return: side(0.035566, 0.035566, true),
    requiredEspInWg: null,
    requiredEspAssumedInWg: null,
  };
  expect(effectWords(r14, r20)).toBe("supply ≥0.0281 → ≥0.0165 · return 0.0469 → 0.0356");
  expect(effectWords(r14, r14)).toBe("no change to this fan's totals");
});

it("a kind that would take the unit off the fan list is a disabled option; the rest stay pickable", () => {
  const rowFor = (node: Node, kind: "erv" | "air-handler", source: "typed" | "suggested") =>
    inputRows({
      snapshot: { nodes: [node] },
      doc: null,
      inputs: inputs({ units: { [node.id]: unit(kind, source) } }),
      fanUnitId: null,
    }).find((r) => r.label === "Unit kind")!;
  const options = (node: Node) => {
    const control = rowFor(node, "erv", "suggested").control;
    if (control.kind !== "kind") throw new Error("kind control");
    return Object.fromEntries(control.options.map((o) => [o.kind, o.disabled]));
  };
  // The B160's two outlets: an air handler takes exactly one, so it is disabled with its reason.
  const b160 = options(erv(6105264));
  expect(b160["air-handler"]).toMatch(
    /^no fan port: 2 outlets \(supply out c2, exhaust out c3\).*leave the fan list/,
  );
  expect(b160.erv).toBeNull();
  expect(b160.other).toBeNull();
  expect(b160.dehumidifier).toBeNull();
  // A one-outlet unit keeps air-handler enabled.
  const single = {
    ...erv(7),
    family: "SunTherm M Series",
    connectors: [port(1, "out", "SupplyAir"), port(2, "in", "ReturnAir")],
  } as Node;
  expect(options(single)["air-handler"]).toBeNull();
  // A stale typed air-handler on the B160 stays the standing value, flagged disabled, clearable.
  const stale = rowFor(erv(6105264), "air-handler", "typed");
  expect(stale.control.kind === "kind" && stale.control.value).toBe("air-handler");
  expect(
    stale.control.kind === "kind" &&
      stale.control.options.find((o) => o.kind === "air-handler")?.disabled,
  ).toBeTruthy();
  expect(stale.clear).not.toBeNull();
});
