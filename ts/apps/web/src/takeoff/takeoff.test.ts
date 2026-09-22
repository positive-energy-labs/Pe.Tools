import { describe, expect, it } from "vite-plus/test";

import {
  buildZones,
  containsEvenOdd,
  decisionRows,
  regionForRoom,
  shoelace,
  zoneGuid,
  zoneStage,
  type DeclaredZone,
  type LiveRegion,
  type PartitionRun,
} from "#/takeoff/model";
import { projectTakeoffSnapshot } from "../../../../packages/mcps/src/shared/takeoff-ops.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZonePeek } from "#/takeoff/zone-peek";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ZONES_JSON = join(
  process.env.PE_PRIVATE_FIXTURES ??
    join(import.meta.dirname, "../../../../../../.private/fixtures"),
  "project-a/web/zones.json",
);
const declared = existsSync(ZONES_JSON)
  ? (JSON.parse(readFileSync(ZONES_JSON, "utf8")) as DeclaredZone[])
  : [];

const square = (x: number, y: number, size: number): [number, number][] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

describe.skipIf(declared.length === 0)("declared zones", () => {
  it("groups all 45 project-a zones onto the four zoning views", () => {
    const zones = buildZones(declared);
    expect(zones).toHaveLength(45);
    expect(new Set(zones.map((z) => z.lane.label))).toEqual(
      new Set(["Lower", "Main", "Upper", "Attic"]),
    );
  });

  it("mints a stable GUID per (level, ordinal) so reruns address the same regions", () => {
    const a = buildZones(declared).find((z) => z.key === "Main#06")!;
    const b = buildZones(declared).find((z) => z.key === "Main#06")!;
    expect(a.guid).toBe(b.guid);
    expect(a.guid).toBe(zoneGuid(1, 6));
    expect(new Set(buildZones(declared).map((z) => z.guid)).size).toBe(45);
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

const region = (elementId: number, blob: string, outer = square(0, 0, 10)): LiveRegion => ({
  elementId,
  role: "room-region",
  guid: "3a9956bd-d135-4290-b184-3cbe93d4d1ea",
  sqft: 100,
  blob,
  outer,
  holes: [],
});

const provenance = (extra = "") =>
  `{"Version":1,"ZoneGuid":"7a4e0000-0000-4000-8000-000000010006","RunId":"r","SourceRoomId":"R01","SourceSqft":70.5${extra}}`;

// ── The decision queue ───────────────────────────────────────────────────────

const run = (over: Partial<PartitionRun> = {}): PartitionRun => ({
  levelName: "Level 1/Main Level",
  elevation: 348,
  created: 0,
  held: 0,
  rebound: 0,
  orphaned: 0,
  domainSqft: 0,
  excludedSqft: 0,
  voidSqft: 0,
  totalSqft: 0,
  enclosureSource: "",
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
    expect(rows[0]).toMatchObject({ kind: "flag", subject: "R01", elementId: 42 });
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

  it("does not bind a room inside a current edited hole", () => {
    const edited = { ...region(42, provenance()), holes: [square(4, 4, 2)] };
    expect(regionForRoom(room("R01", [], [5, 5]), [edited])).toBeUndefined();
    expect(regionForRoom(room("R01", [], [1, 1]), [edited])).toBe(edited);
  });
});

describe("typed snapshot projection", () => {
  it("keeps edited geometry visible while invalidating old measurements and decisions across mixed runs", () => {
    const native: LiveRegion & { roomType: string } = {
      ...region(43, provenance(',"flags":["check"]')),
      roomType: "hall",
      analysis: {
        state: "stale",
        runId: "old",
        floorZ: null,
        ceilingZ: null,
        hold: "geometry-changed",
      },
    };
    const input = {
      reading: {
        at: "11111111-1111-1111-1111-111111111111",
        version: "v",
        observedAt: "2026-09-08T00:00:00Z",
      },
      snapshot: {
        status: {
          systems: [],
          carriers: { stage: "Adoption" as const, status: "ready", missingCarrierGuids: [] },
        },
        zoneFrs: [
          {
            ...region(42, '{"view":"Plan","name":"Renamed zone"}'),
            guid: "zone",
            typeName: "Zone",
            view: "Renamed plan",
            color: "1,2,3",
            loops: [square(0, 0, 30)],
          },
        ],
        regionsByZone: {
          zone: [
            native,
            { ...native, guid: "other-guid", blob: provenance().replace('"r"', '"other-run"') },
          ],
        },
      },
    };
    const project = () =>
      projectTakeoffSnapshot(input, "Document", [{ name: "Renamed plan", level: "Main" }]).world
        .zones[0]!;
    const stale = project();
    expect(stale.zone.guid).toBe("zone");
    expect(stale.zone.lane.view).toBe("Renamed plan");
    expect(stale.rooms[0]).toMatchObject({
      ceilingFt: 0,
      flags: ["geometry-changed", "check"],
    });
    expect(stale.rooms[0]).not.toHaveProperty("decisions");
    expect(stale.savedReview!.shapes.map((shape) => shape.id)).toEqual([native.guid, "other-guid"]);
    expect(stale.savedReview!.shapes[0]!.loops[0]).toEqual(native.outer);
    expect(stale.savedReview!.shapes[0]!.disposition).toBeNull();
    expect(stale.savedReview!.shapes[0]!.reason).toContain("measurements stale");
    expect(stale.driftSqft).toBeNull();
    expect(stale.savedReview!.source.runId).toBeNull();
    expect(stale.savedReview!.shapes[1]!.original?.runId).toBe("other-run");
    input.snapshot.regionsByZone.zone[0] = {
      ...native,
      analysis: { state: "current", runId: "new", floorZ: 0, ceilingZ: 9, hold: null },
    };
    expect(project().rooms[0]).toMatchObject({ ceilingFt: 9, flags: ["check"] });
  });

  it("rejects native review provenance with neither supported field spelling", () => {
    expect(() =>
      projectTakeoffSnapshot(
        {
          reading: {
            at: "document",
            version: "version",
            observedAt: "2026-08-25T12:00:00.000Z",
          },
          snapshot: {
            status: {
              systems: [],
              carriers: { stage: "Adoption", status: "ready", missingCarrierGuids: [] },
            },
            zoneFrs: [
              {
                ...region(42, '{"view":"Plan","name":"Zone"}'),
                typeName: "Zone",
                view: "Plan",
                color: "1,2,3",
                loops: [square(0, 0, 10)],
              },
            ],
            regionsByZone: {
              "3a9956bd-d135-4290-b184-3cbe93d4d1ea": [
                { ...region(43, "{}"), role: "held-residue" as const, roomType: "" },
              ],
            },
          },
        },
        "Document",
        [{ name: "Plan", level: "Level 1" }],
      ),
    ).toThrow("Native takeoff review provenance is missing runId or sourceRoomId");
  });

  it("passes through source identity and derives the world from the typed response", () => {
    const snapshot = projectTakeoffSnapshot(
      {
        reading: {
          at: "11111111-1111-1111-1111-111111111111",
          version: "22222222-2222-2222-2222-222222222222",
          observedAt: "2026-08-25T12:00:00.000Z",
        },
        snapshot: {
          status: {
            systems: [],
            carriers: {
              stage: "Adoption",
              status: "needs-initialization",
              missingCarrierGuids: ["b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9001"],
            },
          },
          zoneFrs: [
            {
              elementId: 42,
              guid: "zone-guid",
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
          regionsByZone: {
            "zone-guid": [
              {
                ...region(
                  43,
                  provenance(
                    ',"partition":{"floorZ":1413,"ceilingZ":1421,"holes":[[90,90,91,90,91,91]]}',
                  ),
                ),
                roomType: "hall",
                holes: [square(4.123456789012345, 4, 2)],
              },
              {
                ...region(44, provenance()),
                guid: "held-guid",
                roomType: "",
                role: "held-residue",
                holes: [square(2, 2, 1)],
              },
            ],
          },
        },
      },
      "project-a",
      [{ name: "Mechanical Zoning Plan", level: "Main" }],
    );

    expect(snapshot.reading).toEqual({
      at: "11111111-1111-1111-1111-111111111111",
      version: "22222222-2222-2222-2222-222222222222",
      observedAt: "2026-08-25T12:00:00.000Z",
    });
    expect(snapshot.carriers).toEqual({
      stage: "Adoption",
      status: "needs-initialization",
      missingCarrierGuids: ["b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9001"],
    });
    expect(snapshot.world).toMatchObject({ docName: "project-a", lanes: [{ label: "Main" }] });
    expect(snapshot.world.zones[0]).toMatchObject({
      name: "Main#01",
      tags: ["FC-8"],
      stage: "partitioned",
    });
    expect(snapshot.regionsByZone["zone-guid"]![0]!.holes).toEqual([
      square(4.123456789012345, 4, 2),
    ]);
    expect(snapshot.world.zones[0]!.rooms[0]!.holes).toEqual([square(4.123456789012345, 4, 2)]);
    expect(snapshot.world.zones[0]!.rooms[0]!.ceilingFt).toBe(0);
    expect(snapshot.world.zones[0]!.rooms[0]!.flags).toContain("remeasure-required");
    expect(snapshot.world.zones[0]!.residues[0]!.holes).toEqual([square(2, 2, 1)]);
    const markup = renderToStaticMarkup(
      createElement(ZonePeek, {
        zone: snapshot.world.zones[0]!,
        cursorRoom: null,
        geoReady: true,
        stateOf: () => "unreviewed" as const,
      }),
    );
    const paths = [...markup.matchAll(/<path\b[^>]*\bd="([^"]*)"[^>]*>/g)];
    expect(paths).toHaveLength(3);
    for (const path of paths.slice(1)) {
      expect(path[1]!.match(/M/g)).toHaveLength(2);
      expect(path[0]).toContain('fill-rule="evenodd"');
    }
  });
});
