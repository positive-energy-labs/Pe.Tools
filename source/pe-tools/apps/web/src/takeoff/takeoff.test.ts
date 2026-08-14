import { describe, expect, it } from "vite-plus/test";

import { toExportRoom } from "#/takeoff/export";
import type { RhvacRoom } from "#/rhvac/types";
import {
  buildZones,
  containsEvenOdd,
  decisionRows,
  readResolutions,
  regionForRoom,
  shoelace,
  upsertResolution,
  zoneGuid,
  zoneStage,
  type LiveRegion,
  type PartitionRun,
} from "#/takeoff/model";
import { decisionScript, partitionScript, registryScript } from "#/takeoff/scripts";

const square = (x: number, y: number, size: number): [number, number][] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

describe("declared zones", () => {
  it("groups all 45 project-a zones onto the four zoning views", () => {
    const zones = buildZones();
    expect(zones).toHaveLength(45);
    expect(new Set(zones.map((z) => z.lane.label))).toEqual(
      new Set(["Lower", "Main", "Upper", "Attic"]),
    );
  });

  it("mints a stable GUID per (level, ordinal) so reruns address the same regions", () => {
    const a = buildZones().find((z) => z.key === "Main#06")!;
    const b = buildZones().find((z) => z.key === "Main#06")!;
    expect(a.guid).toBe(b.guid);
    expect(a.guid).toBe(zoneGuid(1, 6));
    expect(new Set(buildZones().map((z) => z.guid)).size).toBe(45);
  });

  it("measures declared area by shoelace over the even-odd loops", () => {
    expect(shoelace(square(0, 0, 10))).toBe(100);
  });
});

describe("even-odd containment", () => {
  it("matches ZoneScope's rule: a hole flips parity", () => {
    const outer = square(0, 0, 10);
    const hole = square(4, 4, 2);
    expect(containsEvenOdd([outer], 5, 5)).toBe(true);
    expect(containsEvenOdd([outer, hole], 5, 5)).toBe(false);
    expect(containsEvenOdd([outer, hole], 1, 1)).toBe(true);
  });
});

describe("zone stage", () => {
  it("walks unregistered → registered → partitioned", () => {
    expect(zoneStage([], 0)).toBe("unregistered");
    expect(zoneStage(["FC-8"], 0)).toBe("registered");
    expect(zoneStage(["FC-8"], 3)).toBe("partitioned");
  });
});

// ── The write-through review law ─────────────────────────────────────────────

const region = (elementId: number, blob: string, outer = square(0, 0, 10)): LiveRegion => ({
  elementId,
  role: "room-region",
  guid: "3a9956bd-d135-4290-b184-3cbe93d4d1ea",
  sqft: 100,
  blob,
  outer,
});

const provenance = (extra = "") =>
  `{"Version":1,"ZoneGuid":"7a4e0000-0000-4000-8000-000000010006","RunId":"r","SourceRoomId":"R01","SourceSqft":70.5${extra}}`;

describe("resolutions on the provenance blob", () => {
  it("reads the spliced array back out", () => {
    const blob = provenance(
      `,"resolutions":[{"subject":"R01","flag":"seedless","verb":"accept","at":"z","runId":"r"}]`,
    );
    expect(readResolutions(blob)).toHaveLength(1);
    expect(readResolutions(blob)[0]!.verb).toBe("accept");
  });

  it("reads an undecided blob as no decisions, and an unparseable one too", () => {
    expect(readResolutions(provenance())).toEqual([]);
    expect(readResolutions("not json")).toEqual([]);
  });

  it("keeps one decision per (subject, flag) — a later verb replaces the earlier", () => {
    const first = upsertResolution([], {
      subject: "R01",
      flag: "seedless",
      verb: "accept",
      at: "a",
      runId: "r",
    });
    const second = upsertResolution(first, {
      subject: "R01",
      flag: "seedless",
      verb: "dismiss",
      at: "b",
      runId: "r",
    });
    expect(second).toHaveLength(1);
    expect(second[0]!.verb).toBe("dismiss");
  });
});

// ── The decision queue ───────────────────────────────────────────────────────

const run = (over: Partial<PartitionRun> = {}): PartitionRun => ({
  levelName: "Level 1/Main Level",
  elevation: 348,
  created: 0,
  held: 0,
  rebound: 0,
  orphaned: 0,
  domainSqft: 0,
  claimedWallSqft: 0,
  excludedResidueSqft: 0,
  totalSqft: 0,
  profile: "",
  failures: [],
  rooms: [],
  residues: [],
  regions: [],
  ...over,
});

const room = (id: string, flags: string[], label: [number, number] = [5, 5]) => ({
  id,
  rawSqft: 100,
  perimeterFt: 40,
  meanCeilingFt: 9,
  label,
  flags,
  outer: square(0, 0, 10),
});

describe("decision queue", () => {
  it("binds a flagged room to the region that carries its decisions", () => {
    const rows = decisionRows(
      run({ rooms: [room("R01", ["seedless"])], regions: [region(42, provenance())] }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "flag", subject: "R01", elementId: 42, resolved: null });
  });

  it("shows an already-decided row as decided", () => {
    const blob = provenance(
      `,"resolutions":[{"subject":"R01","flag":"seedless","verb":"dismiss","at":"z","runId":"r"}]`,
    );
    const rows = decisionRows(
      run({ rooms: [room("R01", ["seedless"])], regions: [region(42, blob)] }),
    );
    expect(rows[0]!.resolved?.verb).toBe("dismiss");
  });

  it("raises a region no room claimed as an orphan row", () => {
    const rows = decisionRows(
      run({ rooms: [], regions: [region(42, provenance(), square(100, 100, 5))] }),
    );
    expect(rows.map((r) => r.flag)).toEqual(["orphaned-region"]);
  });

  it("keeps a materialize failure in the queue with no home to write to", () => {
    const rows = decisionRows(run({ failures: ["R07: Revit rejected the loop"] }));
    expect(rows[0]).toMatchObject({ kind: "failure", elementId: null });
  });

  it("leaves a clean room out of the queue entirely — it is not a data browser", () => {
    expect(decisionRows(run({ rooms: [room("R01", [])], regions: [region(42, provenance())] })))
      .toHaveLength(0);
  });

  it("does not bind a room to a region it is not inside", () => {
    expect(
      regionForRoom(room("R01", [], [500, 500]), [region(42, provenance())]),
    ).toBeUndefined();
  });
});

// ── The scripts ──────────────────────────────────────────────────────────────

describe("generated C#", () => {
  it("never opens its own transaction — the host owns it", () => {
    const scripts = [
      registryScript({ observed: ["FC-8"], register: ["FC-8"], renames: [] }),
      partitionScript({
        replayPath: "C:\\a\\replay.bin",
        view: "V",
        levelFragment: "Main",
        zoneName: "Main#06",
        zoneGuid: "7a4e0000-0000-4000-8000-000000010006",
        runId: "r",
        loops: [square(0, 0, 10)],
      }),
      decisionScript({ elementId: 42, resolutionsJson: "[]" }),
    ];
    for (const script of scripts) expect(script).not.toMatch(/new Transaction\(/);
  });

  it("embeds zone loops as C# literals — Newtonsoft is unreachable in the scripting context", () => {
    const script = partitionScript({
      replayPath: "C:\\a\\replay.bin",
      view: "V",
      levelFragment: "Main",
      zoneName: "Z",
      zoneGuid: "7a4e0000-0000-4000-8000-000000010006",
      runId: "r",
      loops: [square(1, 2, 3)],
    });
    expect(script).toContain("new double[]{1.000000,2.000000}");
    expect(script).toContain("Pe.Revit.Takeoff.ZoneMaterializer.Materialize");
    expect(script).toContain("doc.Regenerate();");
  });

  it("refuses a non-GUID zone identity rather than splicing it into C#", () => {
    expect(() =>
      decisionScript({ elementId: 1, resolutionsJson: "[]" }),
    ).not.toThrow();
    expect(() =>
      registryScript({ observed: [], register: [], renames: [{ guid: "'; DROP", toTag: "x" }] }),
    ).toThrow(/not a GUID/);
  });

  it("escapes quotes in tags so a typed tag cannot break out of its literal", () => {
    const script = registryScript({ observed: ['FC"8'], register: [], renames: [] });
    expect(script).toContain('"FC\\"8"');
  });
});

// ── Export mapping ───────────────────────────────────────────────────────────

const rhvacRoom = (): RhvacRoom => ({
  identifier: 1,
  number: 1,
  name: "Golf Sim",
  systemNumber: 2,
  zoneNumber: 1,
  areaSquareFeet: 1485,
  ceilingHeightFeet: 9,
  people: 2,
  lightingWatts: 371,
  equipmentSensibleBtuh: 0,
  equipmentLatentBtuh: 0,
  loads: {
    cfmSupplyCooling: 0,
    cfmSupplyHeating: 0,
    cfmSupplyActual: 0,
    temperatureInDuct: 0,
    registersCalculated: 0,
  },
  floors: [{ assembly: "F1", uValue: 0.05, areaSquareFeet: 1485, exposedPerimeterFeet: 40 }],
  roofs: [],
  walls: [
    { index1: 1, assembly: "W1", uValue: 0.06, lengthFeet: 20, heightFeet: 9, direction: 0 },
    { index1: 2, assembly: "W1", uValue: 0.06, lengthFeet: 30, heightFeet: 9, direction: 2 },
  ],
  glass: [
    {
      assembly: "G1",
      uValue: 0.3,
      widthFeet: 3,
      heightFeet: 5,
      wallReference: 2,
      shgc: 0.25,
      occurrences: 2,
    },
  ],
  doors: [{ assembly: "D1", uValue: 0.4, widthFeet: 3, heightFeet: 7, wallReference: 1 }],
});

describe("export lane mapping", () => {
  it("nests openings under their host wall by 1-based ordinal", () => {
    const mapped = toExportRoom(rhvacRoom()) as {
      Walls: { Windows: unknown[]; Doors: unknown[] }[];
    };
    expect(mapped.Walls[0]!.Doors).toHaveLength(1);
    expect(mapped.Walls[0]!.Windows).toHaveLength(0);
    expect(mapped.Walls[1]!.Windows).toHaveLength(1);
  });

  it("lifts loads into InternalLoads and keeps the Identifier the lane matches on", () => {
    const mapped = toExportRoom(rhvacRoom()) as {
      Identifier: number;
      InternalLoads: { People: number; LightingWatts: number };
    };
    expect(mapped.Identifier).toBe(1);
    expect(mapped.InternalLoads).toMatchObject({ People: 2, LightingWatts: 371 });
  });

  it("applies the staged edit and leaves everything else as the file has it", () => {
    const mapped = toExportRoom(rhvacRoom(), {
      identifier: 1,
      name: "Golf Simulator",
      areaSquareFeet: 1486,
    }) as { Name: string; AreaSquareFeet: number; CeilingHeightFeet: number };
    expect(mapped).toMatchObject({
      Name: "Golf Simulator",
      AreaSquareFeet: 1486,
      CeilingHeightFeet: 9,
    });
  });
});
