import { cellPatches, type RouteStatePatch, type CellLike } from "@pe/agent-contracts";

import { DEMO_FAMILIES } from "#/design-system/family-fixtures";

export const PARAMETERS = [
  "Manufacturer",
  "Model",
  "Voltage",
  "Phase",
  "MCA",
  "MOCP",
  "Airflow",
  "Weight",
] as const;
export type Parameter = (typeof PARAMETERS)[number];

export interface MatrixRow {
  key: string;
  family: string;
  type: string;
  baseline: Record<Parameter, string>;
}

type Proposal = NonNullable<CellLike["edit"]>;
export type MatrixCells = Record<string, CellLike>;

const seedModel = (family: number, type: string) =>
  DEMO_FAMILIES[family]?.parameters.find((p) => p.definition.identity.name === "PE_G___Model")
    ?.valuesPerType[type] ?? undefined;

/** family, type prefix, manufacturer, models, then one value per type for the other six. */
const SOURCE: [
  string,
  string,
  string,
  string[],
  string,
  string,
  string[],
  string[],
  string[],
  string[],
][] = [
  [
    DEMO_FAMILIES[0]!.familyName,
    "FCU",
    "Daikin",
    ["FXMQ15", "FXMQ24", "FXMQ30"],
    "230V",
    "1",
    ["2.1A", "3.4A", "4.0A"],
    ["15A", "15A", "15A"],
    ["400", "600", "800"],
    ["88 lb", "104 lb", "121 lb"],
  ],
  [
    DEMO_FAMILIES[1]!.familyName,
    "HP",
    "Daikin",
    ["RXL24", "RXL30", "RXL36"],
    "230V",
    "1",
    ["16A", "19A", "23A"],
    ["25A", "30A", "35A"],
    ["—", "—", "—"],
    ["132 lb", "150 lb", "168 lb"],
  ],
  [
    DEMO_FAMILIES[2]!.familyName,
    "AHU",
    "Daikin",
    ["AHU-10", "AHU-14", "AHU-20"],
    "230V",
    "3",
    ["34A", "41A", "55A"],
    ["45A", "50A", "70A"],
    ["4000", "5600", "8000"],
    ["910 lb", "1180 lb", "1520 lb"],
  ],
  [
    "Exhaust Fan - Inline",
    "EF",
    "Greenheck",
    ["SQ-90", "SQ-120", "SQ-160"],
    "230V",
    "1",
    ["1.8A", "3.1A", "5.2A"],
    ["15A", "15A", "15A"],
    ["450", "900", "1600"],
    ["38 lb", "56 lb", "84 lb"],
  ],
  [
    "VAV Box - Single Duct",
    "VAV",
    "Titus",
    ["DESV-6", "DESV-8", "DESV-10"],
    "24V",
    "1",
    ["—", "—", "—"],
    ["—", "—", "—"],
    ["300", "550", "900"],
    ["22 lb", "27 lb", "33 lb"],
  ],
  [
    "Unit Heater",
    "UH",
    "Modine",
    ["HUH-3", "HUH-5", "HUH-7"],
    "208V",
    "1",
    ["1.2A", "1.9A", "2.6A"],
    ["15A", "15A", "15A"],
    ["620", "1050", "1380"],
    ["45 lb", "62 lb", "80 lb"],
  ],
];

export const MATRIX: readonly MatrixRow[] = SOURCE.flatMap(
  ([family, prefix, maker, models, volts, phase, mca, mocp, airflow, weight], f) =>
    models.map((model, t) => {
      const type = `${prefix}-${t + 1}`;
      return {
        key: type,
        family,
        type,
        baseline: {
          Manufacturer: maker,
          Model: seedModel(f, type) ?? model,
          Voltage: volts,
          Phase: phase,
          MCA: mca[t]!,
          MOCP: mocp[t]!,
          Airflow: airflow[t]!,
          Weight: weight[t]!,
        },
      };
    }),
);

export const cellKey = (row: string, parameter: Parameter) => `${row}::${parameter}`;
const ROWS = new Map(MATRIX.map((row) => [row.key, row]));
export const baselineOf = (key: string) => {
  const [row, parameter] = key.split("::") as [string, Parameter];
  return ROWS.get(row)?.baseline[parameter] ?? null;
};

const pea = (value: string, note?: string): Proposal => ({ value, note, by: "pea" });

export const LOCKS: Readonly<Record<string, string>> = {
  [cellKey("AHU-1", "MCA")]: "driven by a formula in the host project",
};

export const MATRIX_CELLS: MatrixCells = {
  // uniform: one value over 12 cells — the service is 208V
  ...Object.fromEntries(
    MATRIX.filter((row) => row.baseline.Voltage === "230V").map((row) => [
      cellKey(row.key, "Voltage"),
      { edit: pea("208V", "service is 208V/3ph per E-001") },
    ]),
  ),
  // diverse: nine different airflows read off the air schedule
  ...Object.fromEntries(
    (
      [
        ["FCU-1", "425"],
        ["FCU-2", "640"],
        ["FCU-3", "780"],
        ["AHU-1", "4200"],
        ["AHU-2", "5400"],
        ["AHU-3", "8250"],
        ["VAV-1", "325"],
        ["VAV-2", "575"],
        ["VAV-3", "950"],
      ] as const
    ).map(([row, value]) => [cellKey(row, "Airflow"), { edit: pea(value, "M-401 air schedule") }]),
  ),
  // contested inside the uniform group: you edit 240V before Pea said 208V
  [cellKey("FCU-2", "Voltage")]: {
    edit: { value: "240V" },
  },
  // contested: you edit 30A, Pea argues 25A
  [cellKey("HP-2", "MOCP")]: {
    edit: { value: "30A" },
  },
  // locked, with a stray suggestion Pea should not have made
  [cellKey("AHU-1", "MCA")]: { edit: pea("38A") },
};

/** Apply route-document patches (`["cells", key, rung]`, no value = clear) to the local cells. */
export function applyPatches(cells: MatrixCells, patches: readonly RouteStatePatch[]): MatrixCells {
  const next = { ...cells };
  for (const { path, value } of patches) {
    const [, key, rung] = path as [string, string, "edit"];
    next[key] = { ...next[key], [rung]: value ?? null };
  }
  return next;
}

/** A typed edit is the contract's `stage`: the exact value, nothing when it equals the baseline. */
export const stagePatches = (cells: MatrixCells, key: string, text: string) =>
  cellPatches(["cells"], key, cells[key] ?? {}, {
    kind: "set",
    rung: { value: text },
    baseline: { value: baselineOf(key) },
  });

export const shownOf = (key: string, cell: CellLike | undefined) => {
  const rung = cell?.edit;
  return rung?.delete ? "DELETE" : rung ? String(rung.value) : (baselineOf(key) ?? "—");
};
