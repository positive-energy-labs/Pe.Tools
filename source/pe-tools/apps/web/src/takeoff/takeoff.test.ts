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
import { projectTakeoffSnapshot } from "../../../../packages/mcps/src/shared/takeoff-ops.ts";

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

describe("typed snapshot projection", () => {
  it("passes through source identity and derives the world from the typed response", () => {
    const snapshot = projectTakeoffSnapshot({
      from: {
        target: "pe.app-25",
        documentId: "11111111-1111-1111-1111-111111111111",
        documentVersionToken: "22222222-2222-2222-2222-222222222222",
        observedAt: "2026-08-25T12:00:00.000Z",
      },
      snapshot: {
        status: { doc: "project-a", systems: [], regions: [] },
        views: [{ name: "Mechanical Zoning Plan", level: "Main", regions: 1 }],
        zoneFrs: [
          {
            elementId: 42,
            typeName: "Zone",
            view: "Mechanical Zoning Plan",
            color: "1,2,3",
            sqft: 100,
            blob: JSON.stringify({
              view: "Mechanical Zoning Plan",
              name: "Main#01",
              systemTag: "FC-8",
            }),
            loops: [square(0, 0, 10)],
          },
        ],
        regionsByZone: {},
      },
    });

    expect(snapshot.from).toEqual({
      target: "pe.app-25",
      documentId: "11111111-1111-1111-1111-111111111111",
      documentVersionToken: "22222222-2222-2222-2222-222222222222",
      observedAt: "2026-08-25T12:00:00.000Z",
    });
    expect(snapshot.views[0]).toMatchObject({ regions: 1 });
    expect(snapshot.world.zones[0]).toMatchObject({ name: "Main#01", tags: ["FC-8"] });
  });
});
