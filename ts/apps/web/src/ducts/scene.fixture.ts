/**
 * The dev-only subject fixture for the ducts scene: the Chadds makeup-air path Pea traced on
 * 2026-10-17 (`.artifacts/fixtures/makeup-path.json`, 88 ordered elements) as a minimal
 * `ducts.snapshot` plus the five claims written over it. Mounted only under `?demo=scene`
 * (`route.tsx`). Sizes, system names and every name but MUAS-1, FC-23 and the silencer are
 * fixture stand-ins: the trace carried ids, kinds and geometry only.
 * Every row connects to the next, as the 2026-10-19 Chadds read did, but one: the louver side ends
 * at end cap 14107111 and the MUAS-1 side starts at open duct 14122436, stopping 1.6 in short of
 * the cap's face (Chadds' own coordinates), unjoined; the builder joins it by proximity (inferred).
 * The subject leaves out 13761466, 13761629 and 13761574 between FR-1 and FC-23, as Claude's did
 * (an omission).
 */
import type { DuctClaim } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

interface Row {
  id: number;
  k: "duct" | "fitting" | "equipment" | "accessory" | "terminal" | "cap";
  p: number[];
  line?: number[][];
}

/** Main 0 / Upper 12.5 / Attic 24.083 ft. */
export const SCENE_LEVELS = [
  { id: 1, name: "Main", elevationFt: 0 },
  { id: 2, name: "Upper", elevationFt: 12.5 },
  { id: 3, name: "Attic", elevationFt: 24.083 },
] as const;

const NAMES: Record<number, string> = {
  14577391: "MUAS-1",
  14577394: "MUAS-1 coil",
  14577396: "MUAS-1 fan",
  14607308: "silencer",
  14088043: "ESD-403 louver",
  13760866: "FR-1",
  13760867: "FC-23",
};

const ROWS: Row[] = [
  { id: 14088043, k: "terminal", p: [479.02, 686.9, 19.23] },
  { id: 14107098, k: "fitting", p: [479.02, 686.4, 19.23] },
  {
    id: 14106988,
    k: "duct",
    p: [479.02, 686.2, 19.23],
    line: [
      [479.02, 686.2, 19.23],
      [479.02, 683.632, 19.23],
    ],
  },
  { id: 14107111, k: "cap", p: [479.02, 683.632, 19.23] },
  {
    id: 14122436,
    k: "duct",
    p: [479.02, 681.11, 19.23],
    line: [
      [479.02, 683.413, 19.23],
      [479.02, 681.11, 19.23],
    ],
  },
  { id: 14199815, k: "fitting", p: [479.02, 680.48, 19.23] },
  {
    id: 14199813,
    k: "duct",
    p: [478.39, 680.48, 19.23],
    line: [
      [478.39, 680.48, 19.23],
      [474.1, 680.48, 19.23],
    ],
  },
  { id: 14606595, k: "fitting", p: [473.27, 680.48, 19.23] },
  {
    id: 14606587,
    k: "duct",
    p: [473.27, 679.65, 19.23],
    line: [
      [473.27, 679.65, 19.23],
      [473.27, 674.68, 19.23],
    ],
  },
  { id: 14606630, k: "fitting", p: [473.27, 673.84, 19.23] },
  {
    id: 14606628,
    k: "duct",
    p: [473.27, 673.84, 18.4],
    line: [
      [473.27, 673.84, 18.4],
      [473.27, 673.84, 14.4],
    ],
  },
  { id: 14606632, k: "fitting", p: [473.27, 673.84, 13.57] },
  {
    id: 14607324,
    k: "duct",
    p: [474.1, 673.84, 13.57],
    line: [
      [474.1, 673.84, 13.57],
      [478.1, 673.84, 13.57],
    ],
  },
  { id: 14607308, k: "accessory", p: [478.4, 673.84, 13.57] },
  {
    id: 14606746,
    k: "duct",
    p: [478.69, 673.84, 13.57],
    line: [
      [478.69, 673.84, 13.57],
      [478.98, 673.84, 13.57],
    ],
  },
  { id: 14606764, k: "fitting", p: [479.6, 673.84, 13.57] },
  {
    id: 14606754,
    k: "duct",
    p: [479.6, 674.47, 13.57],
    line: [
      [479.6, 674.47, 13.57],
      [479.6, 674.5, 13.57],
    ],
  },
  { id: 14606857, k: "fitting", p: [479.6, 675.12, 13.57] },
  {
    id: 14605353,
    k: "duct",
    p: [478.98, 675.12, 13.57],
    line: [
      [478.98, 675.12, 13.57],
      [478.1, 675.12, 13.57],
    ],
  },
  { id: 14577391, k: "equipment", p: [476.82, 675.13, 13.28] },
  {
    id: 14605319,
    k: "duct",
    p: [474.28, 674.95, 13.0],
    line: [
      [474.28, 674.95, 13.0],
      [474.86, 674.95, 13.0],
    ],
  },
  { id: 14577394, k: "equipment", p: [472.55, 674.95, 13.0] },
  {
    id: 14604869,
    k: "duct",
    p: [470.31, 674.95, 13.0],
    line: [
      [470.31, 674.95, 13.0],
      [470.82, 674.95, 13.0],
    ],
  },
  { id: 14577396, k: "equipment", p: [469.73, 674.95, 12.5] },
  {
    id: 14605796,
    k: "duct",
    p: [468.61, 674.95, 13.0],
    line: [
      [468.61, 674.95, 13.0],
      [469.14, 674.95, 13.0],
    ],
  },
  { id: 14605955, k: "fitting", p: [467.98, 674.95, 13.0] },
  {
    id: 14605875,
    k: "duct",
    p: [467.98, 675.63, 13.0],
    line: [
      [467.98, 675.63, 13.0],
      [467.98, 675.57, 13.0],
    ],
  },
  { id: 14605937, k: "fitting", p: [467.98, 676.26, 13.0] },
  {
    id: 14199828,
    k: "duct",
    p: [467.98, 676.26, 13.62],
    line: [
      [467.98, 676.26, 13.62],
      [467.98, 676.26, 16.91],
    ],
  },
  { id: 14514223, k: "fitting", p: [467.98, 676.26, 18.16] },
  {
    id: 14089232,
    k: "duct",
    p: [466.73, 676.26, 18.16],
    line: [
      [466.73, 676.26, 18.16],
      [465.1, 676.26, 18.16],
    ],
  },
  { id: 14514284, k: "fitting", p: [464.27, 676.26, 18.16] },
  {
    id: 14200059,
    k: "duct",
    p: [464.27, 676.98, 18.58],
    line: [
      [464.27, 676.98, 18.58],
      [464.27, 678.14, 19.25],
    ],
  },
  { id: 14514322, k: "fitting", p: [464.27, 678.33, 19.36] },
  {
    id: 14514312,
    k: "duct",
    p: [464.27, 678.55, 19.36],
    line: [
      [464.27, 678.55, 19.36],
      [464.27, 680.18, 19.36],
    ],
  },
  { id: 14514357, k: "fitting", p: [464.27, 681.01, 19.36] },
  {
    id: 14514416,
    k: "duct",
    p: [463.43, 681.01, 19.36],
    line: [
      [463.43, 681.01, 19.36],
      [454.81, 681.01, 19.36],
    ],
  },
  { id: 14515863, k: "fitting", p: [454.47, 681.01, 19.36] },
  {
    id: 14515909,
    k: "duct",
    p: [454.22, 681.01, 19.12],
    line: [
      [454.22, 681.01, 19.12],
      [454.12, 681.01, 19.02],
    ],
  },
  { id: 14614583, k: "fitting", p: [453.88, 681.01, 18.77] },
  {
    id: 14515917,
    k: "duct",
    p: [451.55, 681.01, 18.77],
    line: [
      [451.55, 681.01, 18.77],
      [453.54, 681.01, 18.77],
    ],
  },
  { id: 14609468, k: "fitting", p: [451.29, 681.01, 18.77] },
  {
    id: 14289977,
    k: "duct",
    p: [450.38, 681.01, 17.86],
    line: [
      [450.38, 681.01, 17.86],
      [451.11, 681.01, 18.59],
    ],
  },
  { id: 14609466, k: "fitting", p: [450.13, 681.01, 17.61] },
  {
    id: 14343729,
    k: "duct",
    p: [449.79, 681.01, 17.61],
    line: [
      [449.79, 681.01, 17.61],
      [449.23, 681.01, 17.61],
    ],
  },
  { id: 14343832, k: "fitting", p: [448.4, 681.01, 17.61] },
  {
    id: 14289132,
    k: "duct",
    p: [448.4, 681.84, 17.61],
    line: [
      [448.4, 681.84, 17.61],
      [448.4, 689.84, 17.61],
    ],
  },
  { id: 14609409, k: "fitting", p: [448.4, 689.95, 17.61] },
  {
    id: 14107508,
    k: "duct",
    p: [448.37, 690.06, 17.61],
    line: [
      [448.37, 690.06, 17.61],
      [447.78, 692.25, 17.61],
    ],
  },
  { id: 14289830, k: "fitting", p: [447.62, 692.86, 17.61] },
  {
    id: 13819016,
    k: "duct",
    p: [447.62, 692.86, 18.24],
    line: [
      [447.62, 692.86, 18.24],
      [447.62, 692.86, 24.08],
    ],
  },
  { id: 13819025, k: "fitting", p: [447.62, 692.86, 24.71] },
  {
    id: 14285478,
    k: "duct",
    p: [447.62, 693.48, 24.71],
    line: [
      [447.62, 693.48, 24.71],
      [447.62, 697.71, 24.71],
    ],
  },
  { id: 14288673, k: "fitting", p: [447.62, 698.34, 24.71] },
  {
    id: 14288671,
    k: "duct",
    p: [447.62, 698.34, 25.33],
    line: [
      [447.62, 698.34, 25.33],
      [447.62, 698.34, 25.35],
    ],
  },
  { id: 14288675, k: "fitting", p: [447.62, 698.34, 25.98] },
  {
    id: 14288515,
    k: "duct",
    p: [448.25, 698.34, 25.98],
    line: [
      [448.25, 698.34, 25.98],
      [449.95, 698.34, 25.98],
    ],
  },
  { id: 14288765, k: "fitting", p: [450.78, 698.34, 25.98] },
  {
    id: 14288763,
    k: "duct",
    p: [450.78, 698.34, 25.15],
    line: [
      [450.78, 698.34, 25.15],
      [450.78, 698.34, 24.92],
    ],
  },
  { id: 14288784, k: "fitting", p: [450.78, 698.34, 24.08] },
  {
    id: 14288754,
    k: "duct",
    p: [453.13, 698.34, 24.08],
    line: [
      [453.13, 698.34, 24.08],
      [451.62, 698.34, 24.08],
    ],
  },
  { id: 14288782, k: "fitting", p: [453.96, 698.34, 24.08] },
  {
    id: 13820267,
    k: "duct",
    p: [453.96, 699.17, 24.08],
    line: [
      [453.96, 699.17, 24.08],
      [453.96, 726.81, 24.08],
    ],
  },
  { id: 14064139, k: "fitting", p: [453.96, 727.65, 24.08] },
  {
    id: 14063848,
    k: "duct",
    p: [453.13, 727.65, 24.08],
    line: [
      [453.13, 727.65, 24.08],
      [450.48, 727.65, 24.08],
    ],
  },
  { id: 14064141, k: "fitting", p: [450.13, 727.65, 24.08] },
  {
    id: 14064127,
    k: "duct",
    p: [449.48, 727.65, 24.74],
    line: [
      [449.48, 727.65, 24.74],
      [449.89, 727.65, 24.33],
    ],
  },
  { id: 14412070, k: "fitting", p: [449.24, 727.65, 24.98] },
  {
    id: 14064126,
    k: "duct",
    p: [448.89, 727.65, 24.98],
    line: [
      [448.89, 727.65, 24.98],
      [445.84, 727.65, 24.98],
    ],
  },
  { id: 14412074, k: "fitting", p: [445.0, 727.65, 24.98] },
  {
    id: 14203294,
    k: "duct",
    p: [445.0, 728.3, 24.33],
    line: [
      [445.0, 728.3, 24.33],
      [445.0, 728.24, 24.39],
    ],
  },
  { id: 14203297, k: "fitting", p: [445.0, 728.54, 24.08] },
  {
    id: 14201305,
    k: "duct",
    p: [445.0, 728.89, 24.08],
    line: [
      [445.0, 728.89, 24.08],
      [445.0, 734.72, 24.08],
    ],
  },
  { id: 14319003, k: "fitting", p: [445.0, 735.56, 24.08] },
  {
    id: 13819246,
    k: "duct",
    p: [445.0, 735.56, 23.25],
    line: [
      [445.0, 735.56, 23.25],
      [445.0, 735.56, 11.42],
    ],
  },
  { id: 13972467, k: "fitting", p: [445.0, 735.56, 10.79] },
  {
    id: 13972541,
    k: "duct",
    p: [444.84, 736.16, 10.79],
    line: [
      [444.84, 736.16, 10.79],
      [444.78, 736.38, 10.79],
    ],
  },
  { id: 13972581, k: "fitting", p: [444.76, 736.46, 10.79] },
  {
    id: 13972573,
    k: "duct",
    p: [444.76, 736.54, 10.79],
    line: [
      [444.76, 736.54, 10.79],
      [444.76, 737.35, 10.79],
    ],
  },
  { id: 13972598, k: "fitting", p: [444.76, 738.18, 10.79] },
  {
    id: 13971833,
    k: "duct",
    p: [444.76, 738.18, 9.96],
    line: [
      [444.76, 738.18, 9.96],
      [444.76, 738.18, 1.75],
    ],
  },
  { id: 13972602, k: "fitting", p: [444.76, 738.18, 0.92] },
  {
    id: 13971825,
    k: "duct",
    p: [444.76, 741.06, 0.92],
    line: [
      [444.76, 741.06, 0.92],
      [444.76, 739.02, 0.92],
    ],
  },
  { id: 13926750, k: "fitting", p: [444.76, 741.9, 0.92] },
  {
    id: 13926748,
    k: "duct",
    p: [445.59, 741.9, 0.92],
    line: [
      [445.59, 741.9, 0.92],
      [447.1, 741.9, 0.92],
    ],
  },
  { id: 13926753, k: "fitting", p: [447.43, 741.9, 0.92] },
  {
    id: 13760945,
    k: "duct",
    p: [448.63, 741.94, 2.68],
    line: [
      [448.63, 741.94, 2.68],
      [448.63, 741.94, 0.37],
    ],
  },
  { id: 13760866, k: "equipment", p: [448.63, 741.94, 3.25] },
  {
    id: 13761466,
    k: "duct",
    p: [448.63, 741.94, 3.25],
    line: [
      [448.63, 741.94, 3.25],
      [448.63, 741.94, 3.38],
    ],
  },
  { id: 13761629, k: "fitting", p: [448.63, 741.94, 3.38] },
  {
    id: 13761574,
    k: "duct",
    p: [448.63, 741.94, 4.48],
    line: [
      [448.63, 741.94, 4.48],
      [448.63, 741.94, 4.13],
    ],
  },
  { id: 13760867, k: "equipment", p: [448.96, 741.94, 4.45] },
];

const levelAt = (z: number) =>
  [...SCENE_LEVELS].reverse().find((level) => level.elevationFt <= z + 0.5)?.id ?? null;
const length = (line: number[][]) =>
  line.slice(1).reduce((sum, p, i) => sum + Math.hypot(...p.map((v, j) => v - line[i]![j]!)), 0);

/** Where the model is not joined: the louver side's end cap and the MUAS-1 side's open duct. */
const UNJOINED = new Set([14107111, 14122436]);
const OMITTED = new Set([13761466, 13761629, 13761574]);

/** Connector 1 reaches the row before, connector 2 the row after, except across `UNJOINED`. */
const connectorsOf = (i: number) =>
  ([ROWS[i - 1], ROWS[i + 1]] as const).map((to, end) => ({
    index: end + 1,
    kind: "end",
    point: ROWS[i]!.line?.[end ? ROWS[i]!.line!.length - 1 : 0] ?? ROWS[i]!.p,
    shape: "round" as const,
    size: '12"ø',
    diameterIn: 12,
    direction: "bidirectional",
    connectedTo:
      to && !(UNJOINED.has(to.id) && UNJOINED.has(ROWS[i]!.id))
        ? { elementId: to.id, connector: end ? 1 : 2 }
        : null,
  }));

const snapshot: DuctSnapshot = {
  coordinateEncoding: "native-double",
  document: {
    title: "scene fixture (Chadds makeup-air trace)",
    readAt: "2026-10-17T00:00:00Z",
    elapsedMs: 0,
    networkBasedCalculations: false,
  },
  levels: [...SCENE_LEVELS],
  groups: [],
  nodes: ROWS.flatMap((row, i) =>
    row.k === "duct"
      ? []
      : [
          {
            id: row.id,
            kind: row.k,
            category: row.k,
            type: NAMES[row.id] ?? null,
            levelId: levelAt(row.p[2]!),
            point: row.p,
            connectors: connectorsOf(i),
            facts: [],
            label: NAMES[row.id] ?? null,
          },
        ],
  ),
  segments: ROWS.flatMap((row, i) => (row.line ? [{ row, i }] : [])).map(({ row, i }) => ({
    id: row.id,
    kind: "duct",
    curveKind: "line",
    shape: "round",
    size: '12"ø',
    diameterIn: 12,
    lengthFt: Math.round(length(row.line!) * 100) / 100,
    polyline: row.line!,
    levelId: levelAt(row.p[2]!),
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors: connectorsOf(i),
  })),
  flows: [],
  issues: [],
  layers: [],
  systems: [],
  slots: {
    fanStatic: "PE_M_Fan_ExternalStaticPressure",
    fanFlow: "PE_M_Fan_AirFlow",
    componentDrop: "Pressure Drop",
    fittingCoefficient: "Pe_C",
    terminalFlow: "PE_M_Grd_AirFlow",
  },
};

export const SCENE_SUBJECT: number[] = ROWS.map((row) => row.id).filter((id) => !OMITTED.has(id));

export const SCENE_CLAIMS: Record<string, DuctClaim> = {
  c1: {
    state: "assumed",
    ids: [14577391, 13760867],
    text: "The intended unit is MUAS-1 and the route ends at FC-23's return inlet.",
  },
  c2: {
    state: "proven",
    ids: [13819016, 13820267, 13819246],
    text: "The run goes up into the attic and back down to the main-level return.",
  },
  c3: {
    state: "unproven",
    ids: [14122436, 14107111],
    text: "The intake is not connected in the model: duct 14122436 ends open 1.6 in short of end cap 14107111 on the plenum 14106988 that feeds louver 14088043; joined by proximity, it needs a ruling.",
  },
  c4: {
    state: "assumed",
    ids: [14515917, 14343729],
    text: "This is a branched network: two takeoffs on the trunk feed ERVs 6105264 and 6953852.",
  },
  c5: {
    state: "unproven",
    ids: [14577391],
    text: "Flow direction needs confirmation: MUAS-1's intake-side port is Out and the silencer-side port is In.",
  },
};

export const SCENE_FIXTURE = { snapshot, subject: SCENE_SUBJECT, claims: SCENE_CLAIMS };
