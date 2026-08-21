import { describe, expect, it } from "vite-plus/test";

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
import { decisionScript, partitionScript, registryScript, snapshotScript } from "#/takeoff/scripts";
import { buildLiveWorld, type SessionOverlay } from "#/takeoff/world";

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
    expect(
      decisionRows(run({ rooms: [room("R01", [])], regions: [region(42, provenance())] })),
    ).toHaveLength(0);
  });

  it("does not bind a room to a region it is not inside", () => {
    expect(regionForRoom(room("R01", [], [500, 500]), [region(42, provenance())])).toBeUndefined();
  });
});

// ── Rerun proposals never silently drop ───────────────────────────────────────

describe("rerun proposals", () => {
  const guid = "7a4e0000-0000-4000-8000-000000010006";
  const zoneFr = {
    elementId: 1,
    typeName: "Zoning",
    view: "V",
    color: "0,0,0",
    sqft: 100,
    role: "zoning-region",
    guid,
    blob: JSON.stringify({ v: 1, view: "V", name: "Z1", systemTag: "FC-8" }),
    loops: [square(0, 0, 10)],
  };
  const overlay: SessionOverlay = {
    // a run that detected a room the rebind matched to no existing region (regions: [])
    runs: { [guid]: run({ rooms: [room("R99", [], [50, 5])], regions: [] }) },
    replays: {},
    edits: {},
  };

  it("flags a rerun-discovered room with no materialized region so it blocks the sync", () => {
    const world = buildLiveWorld({
      status: { doc: "d", systems: [], regions: [] },
      zoneFrs: [zoneFr],
      views: [{ name: "V", level: "Main", regions: 1 }],
      regionsByZone: {},
      overlay,
      r10Path: null,
      r10: null,
    });
    const rooms = world.zones[0]!.rooms;
    expect(rooms).toHaveLength(1);
    // present (not dropped) AND carrying an open call (so blockedZones excludes the zone)
    expect(rooms[0]!.elementId).toBeNull();
    expect(rooms[0]!.flags).toContain("unhomed-proposal");
  });
});

// ── The scripts ──────────────────────────────────────────────────────────────

const embeddedArgument = (script: string, method: string): string => {
  const match = script.match(
    new RegExp(`TakeoffAtlas\\.${method}\\(doc, "((?:\\\\.|[^"])*)"(?:, Notify)?\\)`),
  );
  expect(match).not.toBeNull();
  return JSON.parse(`"${match![1]}"`) as string;
};

describe("generated C#", () => {
  it("delegates product behavior to TakeoffAtlas and output shaping to TakeoffJson", () => {
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
    for (const script of scripts) {
      expect(script).toContain("Pe.Revit.Takeoff.TakeoffAtlas.");
      expect(script).toContain("Pe.Revit.Takeoff.TakeoffJson.Serialize(");
      expect(script).toContain("Result(");
      expect(script).not.toContain("PE_JSON");
      expect(script).not.toMatch(/new Transaction\(|FilteredElementCollector|ZoneMaterializer/);
    }
  });

  it("snapshotScript is the whole-model thin call", () => {
    expect(snapshotScript()).toBe(
      "Result(Pe.Revit.Takeoff.TakeoffJson.Serialize(Pe.Revit.Takeoff.TakeoffAtlas.Snapshot(doc)));",
    );
  });

  it("preserves partition JSON, including loops and C#-sensitive characters", () => {
    const args = {
      replayPath: 'C:\\a\\"quoted"\\replay.bin',
      view: 'V "north"',
      levelFragment: "Main",
      zoneName: "Z\nline 2",
      zoneGuid: "7a4e0000-0000-4000-8000-000000010006",
      runId: "r",
      loops: [square(1, 2, 3)],
    };
    const script = partitionScript(args);
    expect(JSON.parse(embeddedArgument(script, "Partition"))).toEqual(args);
    expect(script).not.toContain("\nline 2");
  });

  it("transports registry JSON as data; typed C# deserialization owns GUID validation", () => {
    const args = {
      observed: ['FC"8', "line\n2"],
      register: ["C:\\FC"],
      renames: [{ guid: "'; DROP", toTag: 'FC"9' }],
    };
    const script = registryScript(args);
    expect(JSON.parse(embeddedArgument(script, "ApplyRegistry"))).toEqual(args);
    expect(script).not.toContain("line\n2");
  });
});
