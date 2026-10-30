import { expect, it } from "vite-plus/test";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { fieldState, INPUT_GROUPS, inputFields, type InputContext } from "./inputs-surface";

const context: InputContext = {
  snapshot: {
    slots: {
      fanStatic: "PE_M_Fan_ExternalStaticPressure",
      terminalDrop: "PE_M_Grd_ExternalStaticPressure",
      componentDrop: "Pressure Drop",
      fittingCoefficient: "Pe_C",
      terminalFlow: "PE_M_Grd_AirFlow",
    },
  } as unknown as DuctSnapshot,
  doc: null,
  revision: 3,
  sheet: null,
  defaults: {
    terminalDropInWg: 0.03,
    terminalDropSource: "SHIM placeholder",
    autoJoinMaxGapIn: 3,
    splitPolicy: "even",
    basis: null,
  },
  projectInputs: { rulings: [{ pair: ["1:0", "2:0"], verdict: "accept" }] },
  slots: [{ slot: "PE_M_Grd_AirFlow", covered: 3, total: 4 }],
  activeSlot: "PE_M_Grd_AirFlow",
  element: null,
};

it("keeps calculation and provenance rows in the sheet; the colour palette moved to route settings", () => {
  const fields = inputFields(context);
  expect(fields).toHaveLength(63);
  expect(new Set(fields.map((f) => f.census)).size).toBe(63);
  for (const group of INPUT_GROUPS)
    expect(fields.filter((f) => f.group === group.key).length).toBeGreaterThan(0);
  for (const field of fields) expect(field.live && field.reason).toBeFalsy();
});

it("labels the 3 in field auto-join gap and shows the read's 36 in candidate box as a C# no-op", () => {
  // The box is the one the C# read measured health under, as the sheet reports it; no sheet, no number.
  expect(new Map(inputFields(context).map((f) => [f.label, f])).get("candidate box")?.value).toBe(
    "— in",
  );
  const sheet = {
    overview: {},
    inputs: { inputs: [{ name: "candidate box in", value: 36, source: "default" }] },
  };
  const byLabel = new Map(
    inputFields({ ...context, sheet: sheet as unknown as InputContext["sheet"] }).map((f) => [
      f.label,
      f,
    ]),
  );
  expect(byLabel.get("auto-join gap")).toMatchObject({ live: "auto-join-gap", value: "3 in" });
  expect(byLabel.get("candidate box")).toMatchObject({ reason: "no-op: C# only", value: "36 in" });
  expect(byLabel.get("terminal drop")).toMatchObject({ shim: "ducts-terminal-drop" });
  expect(byLabel.get("defaults version")).toMatchObject({ value: "unversioned" });
});

it("R3: the firm ESP parameter is labelled required (written); rated ESP has no firm slot", () => {
  const byLabel = new Map(inputFields(context).map((f) => [f.label, f]));
  expect(byLabel.get("required ESP (written)")).toMatchObject({
    group: "fan",
    reason: "no-op: C# only",
  });
  expect(byLabel.get("rated ESP")).toMatchObject({
    value: "— no firm slot",
    reason: "no-op: no home",
  });
});

it("R2: rulings, drops and end cfm are project inputs; the element group reads the focused element", () => {
  const fields = inputFields({
    ...context,
    projectInputs: {
      ...context.projectInputs,
      drops: { 7: 0.05 },
      endCfm: { 7: 120 },
      endRulings: [{ end: { elementId: 9, connector: 1 }, verdict: "capped" }],
    },
    element: { id: 7, family: "Grille" },
  });
  const byLabel = new Map(fields.map((f) => [f.label, f]));
  expect(byLabel.get("join rulings")).toMatchObject({
    group: "project",
    live: "rulings",
    value: "1 accepted · 0 rejected",
  });
  expect(byLabel.get("end rulings")).toMatchObject({
    group: "project",
    live: "end-rulings",
    value: "1 capped",
  });
  expect(byLabel.get("typed drop")).toMatchObject({
    group: "element",
    live: "drop",
    value: "0.05 in-wg",
  });
  expect(byLabel.get("typed end cfm")).toMatchObject({
    group: "element",
    live: "end-cfm",
    value: "120 cfm",
  });
  const states = fields.reduce<Record<string, number>>((acc, f) => {
    const k = `${f.group}:${fieldState(f)}`;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  expect(states).toEqual({
    "firm:live": 3,
    "firm:no-op": 20,
    "project:live": 4,
    "project:no-op": 13,
    "project:read-out": 5,
    "fan:no-op": 7,
    "fan:read-out": 2,
    "element:live": 2,
    "element:no-op": 7,
  });
});
