import { expect, it } from "vite-plus/test";
import {
  applyRulings,
  rosterCensus,
  suggestRoster,
  type RosterRuling,
  type RosterSnapshot,
} from "./roster.ts";

type Node = RosterSnapshot["nodes"][number];
const port = (
  index: number,
  direction: string,
  classification: string,
): Node["connectors"][number] => ({
  index,
  direction,
  classification,
  kind: "end",
  point: [0, 0, 0],
  shape: "round",
  size: "6",
});
const unit = (
  id: number,
  family: string,
  connectors = [port(1, "out", "SupplyAir"), port(2, "in", "ReturnAir")],
): Node => ({
  id,
  family,
  type: "Standard",
  kind: "equipment",
  category: "Mechanical Equipment",
  point: [0, 0, 0],
  connectors,
  facts: [{ key: "mark", text: `U-${id}`, unit: "", provenance: "designer-stated" }],
});
const ahu = unit(1, "SunTherm M Series", undefined);
const erv = unit(2, "Broan_B160E75RT_ERV_R25", [
  port(7, "in", "ExhaustAir"),
  port(9, "out", "ExhaustAir"),
  port(4, "out", "SupplyAir"),
  port(6, "in", "SupplyAir"),
]);
const dehumidifier = unit(3, "Aprilaire Dehumidifier");
const silencer = unit(4, "Fantech Duct Silencer");
const fixture: RosterSnapshot = { nodes: [ahu, erv, dehumidifier, silencer] };
const ruling = (
  unitId: number,
  portIndex: number,
  decision: RosterRuling["decision"] = "fan",
): RosterRuling => ({
  unitId,
  portIndex,
  decision,
  at: "2026-10-27T12:00:00Z",
});

it("proposes one AHU discharge and two separate ERV fan ports with their inlets", () => {
  const roster = suggestRoster(fixture);
  expect(roster.fans).toEqual([]);
  expect(roster.suggestions).toEqual([
    {
      unitId: 1,
      portIndex: 1,
      inletPortIndex: 2,
      tag: "U-1",
      kind: "air-handler",
      side: "supply",
      source: "heuristic",
    },
    {
      unitId: 2,
      portIndex: 4,
      inletPortIndex: 6,
      tag: "U-2",
      kind: "erv",
      side: "supply",
      source: "heuristic",
    },
    {
      unitId: 2,
      portIndex: 9,
      inletPortIndex: 7,
      tag: "U-2",
      kind: "erv",
      side: "exhaust",
      source: "heuristic",
    },
  ]);
});

it("seeds base equipment before family hints, then applies port rulings over either source", () => {
  const snapshot: RosterSnapshot = {
    nodes: [ahu, erv, unit(5, "Unnamed unit")],
    systems: [1, 5].map((id) => ({
      id,
      name: `SA ${id}`,
      classification: "SupplyAir",
      baseEquipmentId: id,
      baseEquipmentConnector: 1,
      criticalPath: [],
      sections: [],
    })),
  };
  expect(suggestRoster(snapshot).suggestions.map((p) => [p.unitId, p.source])).toEqual([
    [1, "base-equipment"],
    [5, "base-equipment"],
    [2, "heuristic"],
    [2, "heuristic"],
  ]);
  const result = suggestRoster(snapshot, [ruling(1, 1, "not-fan"), ruling(2, 9), ruling(5, 1)]);
  expect(result.fans.map((p) => [p.unitId, p.portIndex, p.source])).toEqual([
    [5, 1, "ruling"],
    [2, 9, "ruling"],
  ]);
  expect(result.suggestions.map((p) => [p.unitId, p.portIndex])).toEqual([[2, 4]]);
});

it("excludes side-stream dehumidifiers until ruled, even when Revit calls one base equipment", () => {
  const snapshot = {
    ...fixture,
    systems: [
      {
        id: 1,
        name: "SA",
        classification: "SupplyAir",
        baseEquipmentId: 3,
        criticalPath: [],
        sections: [],
      },
    ],
  };
  expect(suggestRoster(snapshot).suggestions.some((p) => p.unitId === 3)).toBe(false);
  expect(suggestRoster(snapshot, [ruling(3, 1)]).fans).toEqual([
    expect.objectContaining({
      unitId: 3,
      kind: "dehumidifier",
      source: "ruling",
      inletPortIndex: 2,
    }),
  ]);
});

it("never promotes passive equipment or uses fan-parameter presence as a kind heuristic", () => {
  const nodes = [
    silencer,
    unit(5, "Aprilaire 2000 Series MERV16 Filter Chassis"),
    unit(6, "AHU Heater"),
    unit(7, "ERV Damper"),
    unit(8, "Unclassified"),
  ];
  for (const node of nodes)
    node.facts.push({ key: "fanFlow", value: 400, unit: "cfm", provenance: "designer-stated" });
  expect(
    suggestRoster(
      { nodes },
      nodes.slice(0, 4).map((n) => ruling(n.id, 1)),
    ),
  ).toEqual({ fans: [], suggestions: [] });
  expect(rosterCensus({ nodes }).unclassified).toEqual([
    { unitId: 8, family: "Unclassified", type: "Standard" },
  ]);
});

it("uses firm tag before mark, ignores arbitrary label overrides, and preserves inputs", () => {
  const tagged = {
    ...ahu,
    label: "custom label",
    facts: [
      ...ahu.facts,
      {
        key: "PE_G___TagInstance",
        text: " FC-01 ",
        unit: "",
        provenance: "designer-stated" as const,
      },
    ],
  };
  const suggestions = suggestRoster({ nodes: [tagged] }).suggestions;
  const before = structuredClone(suggestions);
  const result = applyRulings(suggestions, [{ ...ruling(1, 1), side: "outdoor" }]);
  expect(result.fans[0]).toMatchObject({ tag: "FC-01", side: "outdoor", source: "ruling" });
  expect(suggestions).toEqual(before);
});

it("uses newest ruling per unit/port, rejects stale ports, and does not re-suggest rejected fans", () => {
  const recent = { ...ruling(2, 9, "not-fan"), at: "2026-10-27T13:00:00Z" };
  const result = suggestRoster(fixture, [recent, ruling(2, 9), ruling(2, 999), ruling(999, 1)]);
  expect(result.fans).toEqual([]);
  expect(result.suggestions.map((p) => p.portIndex)).toEqual([1, 4]);
});

it("leaves ambiguous outlets unresolved instead of choosing by array order", () => {
  const ambiguous = { ...ahu, connectors: [...ahu.connectors, port(5, "out", "SupplyAir")] };
  expect(suggestRoster({ nodes: [ambiguous] }).suggestions).toEqual([]);
  expect(rosterCensus({ nodes: [ambiguous] }).unresolvedPorts).toHaveLength(1);
  expect(suggestRoster({ nodes: [ambiguous] }, [ruling(1, 5)]).fans[0]?.portIndex).toBe(5);
  expect(
    suggestRoster({
      nodes: [ambiguous],
      systems: [
        {
          id: 1,
          name: "SA",
          classification: "SupplyAir",
          baseEquipmentId: 1,
          baseEquipmentConnector: 5,
          criticalPath: [],
          sections: [],
        },
      ],
    }).suggestions[0],
  ).toMatchObject({ portIndex: 5, source: "base-equipment" });
});

it.each([
  ["Fan Coil", "fan-coil"],
  ["AHU", "air-handler"],
  ["Mortex", "air-handler"],
  ["Fantech MUAS", "muas"],
  ["SunTherm MUA", "muas"],
])("classifies %s by name without fan parameters", (family, kind) => {
  expect(suggestRoster({ nodes: [unit(1, family)] }).suggestions[0]?.kind).toBe(kind);
});

it("reports port counts separately from unit counts and names missing base-equipment evidence", () => {
  expect(rosterCensus(fixture)).toMatchObject({
    units: 2,
    ports: 3,
    confirmed: 0,
    pending: 3,
    baseEquipmentAvailable: false,
    byKind: { "air-handler": 1, erv: 2, dehumidifier: 0 },
    bySource: { "base-equipment": 0, ruling: 0, heuristic: 3 },
  });
});
