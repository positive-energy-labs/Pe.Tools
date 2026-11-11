/**
 * The inputs pane kaitpw distrusted on cloud Chadds MUAS-1 (2026-10-30; reconstruction in
 * Pe.Tools/.artifacts/tmp/inputs-trust/reconstruction.md): kind rows by raw key and per instance,
 * fittings ungrouped with mechanism-echo descriptions, rows that vanished when cleared, no undo.
 */
import { expect, it } from "vite-plus/test";
import {
  ductsInputsSchema,
  type DuctsInputs,
  type FittingPricing,
  type Resolved,
} from "@pe/agent-contracts";
import { connOf, factOf, nodeOf } from "@pe/ducts-domain/test-snapshot";
import { fittingGroups, tableMeaning } from "./fitting-groups";
import { kindDisabledReason, kindMeaning } from "./kind-meaning";

const firm = <T>(value: T): Resolved<T> => ({
  value,
  source: "firm",
  ref: "seed",
  units: null,
  version: null,
  status: "valid",
});
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
  connOf(index, null, { direction, classification });
// Broan B160E75RT as Chadds models it: supply and exhaust outlets, supply and exhaust inlets.
const erv = (id: number) =>
  nodeOf(id, "equipment", {
    category: "Mechanical Equipment",
    family: "Broan_B160E75RT_ERV_R25",
    type: "B160E75RT",
    point: [0, 0, 0],
    facts: [factOf("mark", `RV-${id}`)],
    connectors: [
      port(2, "out", "SupplyAir"),
      port(3, "out", "ExhaustAir"),
      port(1, "in", "ExhaustAir"),
      port(4, "in", "SupplyAir"),
    ],
  });
const unit = (kind: "erv" | "air-handler", source: "Work" | "default") => ({
  kind: {
    value: kind,
    source,
    units: null,
    version: null,
    status: "valid" as const,
    ...(source === "default" ? { ref: "name" } : {}),
  },
  role: {
    units: null,
    version: null,
    status: "valid" as const,
    value: "fan" as const,
    source: "default" as const,
    ref: "name",
  },
  cfm: {
    units: "cfm",
    version: null,
    status: "valid" as const,
    value: 35,
    source: "model" as const,
    ref: "PE_M_Fan_AirFlow",
  },
  esp: {
    units: "in-wg",
    version: null,
    status: "missing" as const,
    value: null,
    source: "none" as const,
  },
});

it("each kind option says what it means for this unit's ports, role and flow", () => {
  const node = erv(6105264);
  const u = unit("erv", "default");
  expect(kindMeaning(node, "erv", u)).toBe(
    "fan: supply out c2 from supply in c4; exhaust out c3 from exhaust in c1 · flow 35 cfm (model PE_M_Fan_AirFlow)",
  );
  // The r22 choice: an air handler takes one outlet, so this unit loses its fan ports.
  expect(kindMeaning(node, "air-handler", u)).toMatch(
    /^no fan port: 2 outlets \(supply out c2, exhaust out c3\)/,
  );
  expect(kindMeaning(node, "other", u)).toMatch(/^passive: adds its drop and moves no air/);
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
  const typedIn = inputs({
    tables: {
      "elbow-1d-le10": {
        value: "CD3-21",
        source: "Work",
        units: null,
        version: null,
        status: "valid",
      },
    },
  });
  const [g] = fittingGroups(
    [fitting(1, { table: "CD3-21", tableSource: "typed" })],
    typedIn,
    TITLES,
  );
  expect(g!.source).toBe("Work");
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
    inputs({
      tables: {
        "trx-round": {
          value: "SD4-1",
          source: "Work",
          units: null,
          version: null,
          status: "valid",
        },
      },
    }),
    TITLES,
  );
  expect(groups.map((g) => [g.key, g.members.length, g.source])).toEqual([
    ["family:Round Elbow", 1, "not priced"],
    ["rule:trx-round", 0, "Work"],
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

it("a kind that would take the unit off the fan list is a disabled reason; the rest stay pickable", () => {
  // The B160's two outlets: an air handler takes exactly one, so it is disabled with its reason.
  const b160 = erv(6105264), u = unit("erv", "default");
  expect(kindDisabledReason(b160, "air-handler", u)).toMatch(
    /^no fan port: 2 outlets \(supply out c2, exhaust out c3\).*leave the fan list/,
  );
  for (const kind of ["erv", "other", "dehumidifier"] as const) expect(kindDisabledReason(b160, kind, u)).toBeNull();
  // A one-outlet unit keeps air-handler enabled.
  const single = {
    ...erv(7),
    family: "SunTherm M Series",
    connectors: [port(1, "out", "SupplyAir"), port(2, "in", "ReturnAir")],
  };
  expect(kindDisabledReason(single, "air-handler", u)).toBeNull();
});
