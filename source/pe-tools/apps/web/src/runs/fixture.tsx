import { useEffect, type ReactNode } from "react";

import { fb, itemKey, type StagedItem } from "./feedback/staging";
import { RunsSourceProvider, type RunsSource } from "./source";
import type {
  ClassRaster,
  Raster,
  Ring,
  RunReport,
  RunScores,
  ZoneGeometry,
  ZoneRecord,
} from "./world";

const runCurrent = "fixture-20260830-optimized";
const runBaseline = "fixture-20260829-baseline";
const runPartial = "fixture-20260828-zone-tune";
const runLegacy = "fixture-20260827-no-scores";

function zone(args: {
  level: string;
  number: string;
  x: number;
  y: number;
  acceptedRooms: number;
  acceptedSqft: number;
  heldRooms?: number;
  heldSqft?: number;
  verdict: "solve" | "hold";
  reason: string;
  ink?: number;
  excludedSqft?: number;
  knob?: string;
}): ZoneRecord {
  const name = `${args.level}#${args.number}`;
  const width = 36;
  const height = 24;
  const heldSqft = args.heldSqft ?? 0;
  return {
    Level: args.level,
    Zone: name,
    MinX: args.x,
    MinY: args.y,
    MaxX: args.x + width,
    MaxY: args.y + height,
    ZoneLoops: [
      [
        [args.x, args.y],
        [args.x + width, args.y],
        [args.x + width, args.y + height],
        [args.x, args.y + height],
      ],
    ],
    Tsv: `${args.level.toLowerCase().replaceAll(" ", "-")}-${args.number}.tsv`,
    Ink: `${args.level.toLowerCase().replaceAll(" ", "-")}.inkp.gz`,
    Seals: "seals.bin",
    Close: "close.bin",
    OracleRooms: args.acceptedRooms + (args.heldRooms ?? 0),
    RawRooms: args.acceptedRooms + (args.heldRooms ?? 0) + 1,
    AcceptedRooms: args.acceptedRooms,
    HeldRooms: args.heldRooms ?? 0,
    PartitionSqft: args.acceptedSqft + heldSqft + (args.excludedSqft ?? 0),
    AcceptedSqft: args.acceptedSqft,
    HeldSqft: heldSqft,
    VoidSqft: 18,
    ExcludedSqft: args.excludedSqft ?? 0,
    ZoneSqft: width * height,
    InkBackedEdgeFraction: args.ink ?? 0.9,
    StrictlyEditable: args.verdict === "solve",
    Contained: true,
    Rejections: heldSqft ? { "thin-room": 1, "weak-edge": 2 } : { "weak-edge": 1 },
    RejectionDetails: heldSqft ? { H01: "thin-room", R02: "weak-edge" } : { R01: "weak-edge" },
    adaptedKnobs: args.knob ? { gapCloseFt: args.knob } : {},
    census: {
      zoneSqft: width * height,
      inkSqft: width * height * (args.ink ?? 0.9),
      inkRatio: args.ink ?? 0.9,
      edgeBandInkFraction: args.ink ?? 0.9,
    },
    triage: { verdict: args.verdict, reason: args.reason },
    closure: {
      doorHeadSqft: 12,
      doorHeadOversizeSqft: args.verdict === "hold" ? 24 : 0,
      wallRunGapSqft: args.verdict === "hold" ? 36 : 8,
      gapCloseSqft: args.verdict === "hold" ? 28 : 6,
    },
    zoneKey: `${args.level.slice(0, 2).toLowerCase()}${args.number.padStart(2, "0")}fixture`,
  };
}

const currentZones = [
  zone({
    level: "Main Level",
    number: "09",
    x: 0,
    y: 0,
    acceptedRooms: 2,
    acceptedSqft: 1800,
    verdict: "solve",
    reason: "all rooms partitioned on strong wall evidence",
    ink: 0.94,
  }),
  zone({
    level: "Main Level",
    number: "05",
    x: 44,
    y: 0,
    acceptedRooms: 2,
    acceptedSqft: 1450,
    verdict: "solve",
    reason: "door closures reconcile the corridor edge",
    ink: 0.88,
    knob: "1.5",
  }),
  zone({
    level: "Lower Level",
    number: "06",
    x: 0,
    y: 34,
    acceptedRooms: 0,
    acceptedSqft: 0,
    heldRooms: 1,
    heldSqft: 240,
    excludedSqft: 45,
    verdict: "hold",
    reason: "thin mechanical chase remains weakly evidenced",
    ink: 0.61,
  }),
  zone({
    level: "Upper Level",
    number: "04",
    x: 44,
    y: 34,
    acceptedRooms: 3,
    acceptedSqft: 2730,
    verdict: "solve",
    reason: "stable perimeter with one excluded shaft",
    ink: 0.91,
    excludedSqft: 80,
  }),
];

const baselineZones = [
  zone({
    level: "Main Level",
    number: "09",
    x: 0,
    y: 0,
    acceptedRooms: 2,
    acceptedSqft: 1680,
    heldRooms: 1,
    heldSqft: 120,
    verdict: "hold",
    reason: "north room edge was not yet reconciled",
    ink: 0.78,
  }),
  zone({
    level: "Main Level",
    number: "05",
    x: 44,
    y: 0,
    acceptedRooms: 2,
    acceptedSqft: 1410,
    verdict: "solve",
    reason: "corridor partition accepted",
    ink: 0.82,
  }),
  zone({
    level: "Lower Level",
    number: "06",
    x: 0,
    y: 34,
    acceptedRooms: 0,
    acceptedSqft: 0,
    heldRooms: 2,
    heldSqft: 480,
    verdict: "hold",
    reason: "two chase candidates lack wall evidence",
    ink: 0.52,
  }),
  zone({
    level: "Upper Level",
    number: "04",
    x: 44,
    y: 34,
    acceptedRooms: 1,
    acceptedSqft: 2030,
    verdict: "solve",
    reason: "single large room accepted",
    ink: 0.85,
  }),
];

function report(
  generatedUtc: string,
  zones: ZoneRecord[],
  optionsHash: string,
  zoneFilter: string | null | undefined = null,
): RunReport {
  return {
    SchemaVersion: 4,
    GeneratedUtc: generatedUtc,
    optionsHash,
    options: { edgeThreshold: 0.7, gapCloseFt: optionsHash === "opts-b" ? 1.5 : 1 },
    ...(zoneFilter !== undefined ? { zoneFilter } : {}),
    Zones: zones,
    RejectionHistogram: zones.reduce<Record<string, number>>((all, item) => {
      for (const [reason, count] of Object.entries(item.Rejections))
        all[reason] = (all[reason] ?? 0) + count;
      return all;
    }, {}),
  };
}

const reports = new Map<string, RunReport>([
  [runCurrent, report("2026-08-30T15:42:00Z", currentZones, "opts-b")],
  [runBaseline, report("2026-08-29T18:10:00Z", baselineZones, "opts-a")],
  [
    runPartial,
    report("2026-08-28T21:05:00Z", baselineZones.slice(0, 1), "opts-a", "Main Level#09"),
  ],
  [runLegacy, report("2026-08-27T14:20:00Z", baselineZones, "opts-legacy", undefined)],
]);

const score = (savedWork: number, roomRecall: number, edgeOnInkAccepted: number): RunScores => ({
  currency: "v1.1-clean-oracle",
  board: {
    oracleRoomsInZones: 8,
    roomRecall,
    heldRecall: 0.75,
    missing: 1,
    savedWork,
    edgeOnInkAccepted,
    edgeOnInkHeld: 0.66,
    swallowSf: 32,
    meanEditCostAccepted: 0.14,
  },
  boardV1RawOracle: {
    oracleRoomsInZones: 9,
    roomRecall: roomRecall - 0.03,
    heldRecall: 0.7,
    missing: 2,
    savedWork: savedWork - 0.04,
    edgeOnInkAccepted: edgeOnInkAccepted - 0.02,
    edgeOnInkHeld: 0.62,
    swallowSf: 44,
    meanEditCostAccepted: 0.18,
  },
});

const scores = new Map<string, RunScores | null>([
  [runCurrent, score(0.842, 0.875, 0.91)],
  [runBaseline, score(0.781, 0.75, 0.84)],
  [runPartial, score(0.79, 0.8, 0.86)],
  [runLegacy, null],
]);

const raster: Raster = {
  w: 4,
  h: 4,
  minX: 0,
  minY: 0,
  cellFt: 1,
  bits: new Uint8Array([0, 0]),
};

function geometry(runId: string, path: string): ZoneGeometry {
  const report = reports.get(runId);
  const source = report?.Zones.find((item) => item.Tsv === path);
  if (!source) return { rooms: [], polys: new Map(), residues: [] };
  if (
    source.AcceptedRooms === null ||
    source.HeldRooms === null ||
    source.AcceptedSqft === null ||
    source.HeldSqft === null
  )
    throw new Error("fixture geometry requires measured values");
  const count = source.AcceptedRooms + source.HeldRooms;
  const rooms = Array.from({ length: count }, (_, index) => {
    const accepted = index < source.AcceptedRooms!;
    return {
      id: `R${String(index + 1).padStart(2, "0")}`,
      sqft: accepted
        ? source.AcceptedSqft! / Math.max(1, source.AcceptedRooms!)
        : source.HeldSqft! / Math.max(1, source.HeldRooms!),
      lx: source.MinX + 8 + index * 8,
      ly: source.MinY + 12,
      ceil: 9,
      disposition: accepted ? ("accepted" as const) : ("held" as const),
    };
  });
  const polys = new Map<string, Ring[]>(
    rooms.map((room, index) => {
      const x = source.MinX + 2 + index * 8;
      return [
        room.id,
        [
          {
            kind: "room",
            points: [
              [x, source.MinY + 3],
              [x + 7, source.MinY + 3],
              [x + 7, source.MinY + 20],
              [x, source.MinY + 20],
            ] as [number, number][],
          },
        ] as Ring[],
      ] as const;
    }),
  );
  const residues = source.ExcludedSqft
    ? [
        {
          id: "X01",
          reason: "excluded",
          sqft: source.ExcludedSqft,
          loops: [
            [
              [source.MaxX - 6, source.MinY + 2],
              [source.MaxX - 2, source.MinY + 2],
              [source.MaxX - 2, source.MinY + 8],
              [source.MaxX - 6, source.MinY + 8],
            ],
          ] as [number, number][][],
        },
      ]
    : [];
  return { rooms, polys, residues };
}

const source: RunsSource = {
  fetchRunIndex: async () => ({
    pool: "fixture://takeoff-runs/review",
    runs: [
      {
        id: runCurrent,
        meta: {
          runId: runCurrent,
          generatedUtc: "2026-08-30T15:42:00Z",
          optionsHash: "opts-b",
          label: "closure tuning candidate",
        },
      },
      {
        id: runBaseline,
        meta: {
          runId: runBaseline,
          generatedUtc: "2026-08-29T18:10:00Z",
          optionsHash: "opts-a",
          label: "accepted baseline",
        },
      },
      {
        id: runPartial,
        meta: {
          runId: runPartial,
          generatedUtc: "2026-08-28T21:05:00Z",
          optionsHash: "opts-a",
          label: "ML09 focused assay",
          zoneFilter: "Main Level#09",
        },
      },
      {
        id: runLegacy,
        meta: {
          runId: runLegacy,
          generatedUtc: "2026-08-27T14:20:00Z",
          optionsHash: "opts-legacy",
          label: "pre-score package",
        },
      },
    ],
  }),
  loadRunReport: async (runId) => {
    const value = reports.get(runId);
    if (!value) throw new Error(`fixture run not found: ${runId}`);
    return value;
  },
  loadRunScores: async (runId) => scores.get(runId) ?? null,
  poolModalZones: async () => 4,
  loadPlan: async () => null,
  loadRaster: async () => raster,
  loadReplaySeedInk: async () => raster,
  loadSealClasses: async (): Promise<ClassRaster> => ({
    ...raster,
    classes: new Uint8Array(16),
  }),
  loadZoneGeometry: async (runId, path) => geometry(runId, path),
  hydrateFromSet: async () => undefined,
  runExport: async () => undefined,
  exportEnabled: false,
  initialLedgerOpen: true,
};

const fixtureFeedback: StagedItem[] = [
  {
    key: itemKey("Main Level#09", runBaseline, runCurrent),
    zone: "Main Level#09",
    level: "Main Level",
    runA: runBaseline,
    runB: runCurrent,
    a: baselineZones[0]!,
    b: currentZones[0]!,
    flags: ["room:R01"],
    note: "North edge is now ink-backed; keep the accepted split.",
    stagedAt: Date.parse("2026-08-30T16:00:00Z"),
  },
  {
    key: itemKey("Lower Level#06", runBaseline, runCurrent),
    zone: "Lower Level#06",
    level: "Lower Level",
    runA: runBaseline,
    runB: runCurrent,
    a: baselineZones[2]!,
    b: currentZones[2]!,
    flags: ["residue:X01"],
    note: "Hold until the chase boundary is confirmed in Revit.",
    stagedAt: Date.parse("2026-08-30T16:02:00Z"),
  },
];

export function FixtureRunsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const before = fb.get();
    fb.replaceAll(fixtureFeedback, "fixture-review");
    return () => fb.replaceAll(before.items, before.loadedSet);
  }, []);
  return <RunsSourceProvider source={source}>{children}</RunsSourceProvider>;
}
