/**
 * Smoke the /rhvac fixture lane against the real project-a data checked into
 * public/rhvac-fixture: the TSV parser must accept every committed takeoff
 * snapshot, the room map's candidate keys must resolve to parsed polygons, and
 * the extract must normalize into identifiable rooms with a usable assembly
 * catalog.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { deriveAssemblyCatalog } from "./assemblies";
import {
  applyResolutions,
  provenanceMismatch,
  toResolutionsFile,
  type FlagResolution,
} from "./resolutions";
import {
  levelBounds,
  mergeTakeoffLevels,
  parseTakeoffTsv,
  shapeCentroid,
  shapePathD,
} from "./takeoff";
import { candidateKey, normalizeExtract, type RhvacExtract, type RoomMap } from "./types";

const FIXTURE_DIR = join(import.meta.dirname, "../../public/rhvac-fixture");
const ANCHOR_FIXTURE = join(
  import.meta.dirname,
  "../../../../../../eval/rhvac/fixtures/sidecar-anchor-remap.json",
);

const readFixture = (name: string) => {
  const text = readFileSync(join(FIXTURE_DIR, name), "utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
};

const manifest = JSON.parse(readFixture("manifest.json")) as {
  extract: string;
  roomMap: string;
  takeoff: string[];
};

const parseFlaggedUnitTakeoff = () =>
  parseTakeoffTsv(
    [
      "META\tlevel\tLevel 9/Flag Demo",
      "META\telev\t0.000000",
      "ROOM\tR01\t1200.0\t140.0\t20.0\t15.0\t9.00",
      "POLY\tR01\touter\t0;0|40;0|40;30|0;30",
      "ROOM\tR02\t600.0\t100.0\t50.0\t15.0\t9.00",
      "POLY\tR02\touter\t40;0|60;0|60;30|40;30",
      "ROOM\tR03\t800.0\t120.0\t30.0\t40.0\t8.00",
      "POLY\tR03\touter\t0;30|60;30|60;50|0;50",
      "META\tflag\tR01:open-plan-merge",
      "META\tflag\tR02:low-evidence-boundary+open-plan-merge",
      "",
    ].join("\n"),
  );

const parseMergeUnitTakeoff = (
  source: string,
  rooms: { id: string; sqft: number }[],
  residue = false,
) =>
  parseTakeoffTsv(
    [
      "META\tlevel\tMerge Demo",
      "META\telev\t0",
      `META\tsource\t${source}`,
      ...rooms.flatMap(({ id, sqft }, index) => [
        `ROOM\t${id}\t${sqft}\t40\t${index * 12 + 5}\t5\t9`,
        `POLY\t${id}\touter\t${index * 12};0|${index * 12 + 10};0|${index * 12 + 10};10|${index * 12};10`,
      ]),
      ...(residue ? ["META\tresidue\tX01\tcrumb\t25\t30\t5\t9\t28;0|33;0|33;5|28;5"] : []),
    ].join("\n"),
  );

describe("rhvac fixture lane", () => {
  const levels = mergeTakeoffLevels(
    manifest.takeoff.map((name) => parseTakeoffTsv(readFixture(name))),
  );
  const extract = normalizeExtract(JSON.parse(readFixture(manifest.extract)) as RhvacExtract);
  const roomMap = JSON.parse(readFixture(manifest.roomMap)) as RoomMap;

  it("parses every committed takeoff TSV into named levels with polygons", () => {
    expect(levels).toHaveLength(5);
    for (const level of levels) {
      expect(level.levelName.length).toBeGreaterThan(0);
      expect(level.rooms.length).toBeGreaterThan(0);
      const bounds = levelBounds(level);
      expect(bounds).not.toBeNull();
      for (const room of level.rooms) {
        expect(room.outer.length).toBeGreaterThanOrEqual(3);
        expect(shapePathD(room, bounds!)).toMatch(/^M.*Z/);
        const [cx, cy] = shapeCentroid(room, bounds!);
        expect(Number.isFinite(cx)).toBe(true);
        expect(Number.isFinite(cy)).toBe(true);
      }
    }
    const theatre = levels.find((level) => level.levelName === "Level 0/Theatre")!;
    expect(theatre.rooms.filter((room) => room.native).map((room) => room.id)).toEqual([
      "R01",
      "R02",
      "R03",
      "N01",
    ]);
  });

  it("returns POLY vertices verbatim", () => {
    const level = parseTakeoffTsv(
      "META\tlevel\tL1\nMETA\telev\t0\nROOM\tR01\t0.5\t3\t0.5\t0.25\t9\n" +
        "POLY\tR01\touter\t0;0|0.25;0|0.5;0|0.75;0|1;0|1;0.25|1;0.5|0;0.5",
    );

    expect(level.rooms[0]!.outer).toHaveLength(8);
    expect(level.rooms[0]!.outer[0]).toEqual([0, 0]);
    expect(level.rooms[0]!.outer.at(-1)).toEqual([0, 0.5]);
  });

  it("room-map candidates all resolve to parsed polygons, oracle numbers to rooms", () => {
    const candidates = new Set(
      levels.flatMap((level) => level.rooms.map((room) => candidateKey(level.levelName, room.id))),
    );
    const roomNumbers = new Set(extract.rooms.map((room) => room.number));
    for (const match of roomMap.matches) {
      expect(candidates.has(match.candidate)).toBe(true);
      expect(roomNumbers.has(match.oracleNumber)).toBe(true);
    }
  });

  it("old TSVs without flag lines parse with no flags", () => {
    const level = parseTakeoffTsv(
      [
        "META\tlevel\tLegacy",
        "META\telev\t0",
        "ROOM\tR01\t100\t40\t5\t5\t9",
        "POLY\tR01\touter\t0;0|10;0|10;10|0;10",
      ].join("\n"),
    );
    expect(level.rooms[0]!.flags).toBeUndefined();
  });

  it("normalizes the extract with unique identifiers and derives a non-empty assembly catalog", () => {
    expect(extract.rooms).toHaveLength(150);
    const identifiers = new Set(extract.rooms.map((room) => room.identifier));
    expect(identifiers.size).toBe(150);

    const catalog = deriveAssemblyCatalog(extract);
    expect(catalog.walls.length).toBeGreaterThan(0);
    expect(catalog.glass.length).toBeGreaterThan(0);
    expect(catalog.floors.length).toBeGreaterThan(0);
    for (const option of catalog.glass) expect(option.shgc).toBeDefined();
  });
});

describe("native takeoff merge", () => {
  it("native room geometry wins by id", () => {
    const detector = parseMergeUnitTakeoff("detector", [{ id: "R01", sqft: 100 }]);
    const native = parseMergeUnitTakeoff("native", [{ id: "R01", sqft: 900 }]);

    const room = mergeTakeoffLevels([detector, native])[0]!.rooms[0]!;

    expect(room).toMatchObject({ id: "R01", rawSqft: 900, native: true });
  });

  it("keeps detector rooms with no native counterpart", () => {
    const detector = parseMergeUnitTakeoff("detector", [
      { id: "R01", sqft: 100 },
      { id: "R02", sqft: 200 },
    ]);
    const native = parseMergeUnitTakeoff("native", [{ id: "R01", sqft: 900 }]);

    expect(
      mergeTakeoffLevels([detector, native])[0]!.rooms.map(({ id, rawSqft, native }) => ({
        id,
        rawSqft,
        native,
      })),
    ).toEqual([
      { id: "R01", rawSqft: 900, native: true },
      { id: "R02", rawSqft: 200, native: undefined },
    ]);
  });

  it("adds native-only room ids", () => {
    const detector = parseMergeUnitTakeoff("detector", [{ id: "R01", sqft: 100 }]);
    const native = parseMergeUnitTakeoff("native", [
      { id: "R01", sqft: 900 },
      { id: "N01", sqft: 300 },
    ]);

    expect(mergeTakeoffLevels([detector, native])[0]!.rooms.map(({ id }) => id)).toEqual([
      "R01",
      "N01",
    ]);
  });

  it("keeps residues from the detector level", () => {
    const detector = parseMergeUnitTakeoff("detector", [{ id: "R01", sqft: 100 }], true);
    const native = parseMergeUnitTakeoff("native", [{ id: "R01", sqft: 900 }]);

    expect(mergeTakeoffLevels([detector, native])[0]!.residues.map(({ id }) => id)).toEqual([
      "X01",
    ]);
  });

  it("throws for an unknown takeoff source", () => {
    expect(() => parseMergeUnitTakeoff("survey", [{ id: "R01", sqft: 100 }])).toThrow(
      "unknown takeoff source 'survey'",
    );
  });

  it("does not replay detector resolutions over native geometry", () => {
    const detector = parseMergeUnitTakeoff("detector", [{ id: "R01", sqft: 100 }]);
    const native = parseMergeUnitTakeoff("native", [{ id: "R01", sqft: 900 }]);

    const result = applyResolutions(mergeTakeoffLevels([detector, native]), [
      { candidateKey: "Merge Demo:R01", flag: "open-plan-merge", action: "reject" },
    ]);

    expect(result).toMatchObject({ applied: 0, remapped: 0, orphaned: 1 });
    expect(result.levels[0]!.rooms[0]).toMatchObject({ id: "R01", rawSqft: 900, native: true });
    expect(result.levels[0]!.residues).toEqual([]);
  });
});

describe("ambiguity flags + resolutions", () => {
  it("parses real META flag lines from the Partition fixture", () => {
    const level = parseTakeoffTsv(readFixture("rooms_Level_1_Main_Level.tsv"));
    expect(level.levelName).toBe("Level 1/Main Level");
    const byId = new Map(level.rooms.map((r) => [r.id, r]));
    expect(byId.get("R03")!.flags).toEqual([
      "low-evidence-boundary",
      "open-plan-merge",
      "ruled-seam",
    ]);
    expect(byId.get("R13")!.flags).toEqual(["low-evidence-boundary", "unregularized"]);
    expect(level.rooms.filter((room) => room.flags?.length).length).toBe(68);
  });

  it("ignores flag lines naming unknown rooms and malformed payloads", () => {
    const tsv = [
      "META\tlevel\tL",
      "META\telev\t0.000000",
      "ROOM\tR01\t100.0\t40.0\t5.0\t5.0\t9.00",
      "POLY\tR01\touter\t0;0|10;0|10;10|0;10",
      "META\tflag\tR99:open-plan-merge",
      "META\tflag\tno-colon-payload",
      "META\tflag\tR01:",
      "",
    ].join("\n");
    const level = parseTakeoffTsv(tsv);
    expect(level.rooms[0]!.flags).toBeUndefined();
  });

  it("applyResolutions is idempotent and durable across re-parse", () => {
    const parse = () => [parseFlaggedUnitTakeoff()];
    const resolutions: FlagResolution[] = [
      {
        candidateKey: "Level 9/Flag Demo:R01",
        flag: "open-plan-merge",
        action: "reject",
        anchor: { label: [20, 15], sqft: 1200 },
      },
      {
        candidateKey: "Level 9/Flag Demo:R02",
        flag: "open-plan-merge",
        action: "accept",
        anchor: { label: [55, 5], sqft: 600 },
      },
    ];
    const once = applyResolutions(parse(), resolutions).levels;
    const twice = applyResolutions(once, resolutions).levels;
    expect(twice).toEqual(once);
    // Replaying against a fresh parse of the same TSV yields the same rooms.
    expect(applyResolutions(parse(), resolutions).levels).toEqual(once);

    const rooms = new Map(once[0]!.rooms.map((r) => [r.id, r]));
    expect(rooms.has("R01")).toBe(false); // rejected out of the room set
    expect(once[0]!.residues.map((r) => [r.id, r.reason, r.claimed])).toEqual([
      ["R01", "rejected", true],
    ]);
    // R02's open-plan-merge accepted; its low-evidence-boundary still pending.
    expect(rooms.get("R02")!.flags).toEqual(["low-evidence-boundary"]);
    // Untouched room passes through unchanged.
    expect(rooms.get("R03")!.flags).toBeUndefined();
  });

  it("skips resolutions whose candidate no longer exists", () => {
    const levels = [parseFlaggedUnitTakeoff()];
    const ghost: FlagResolution[] = [
      { candidateKey: "Level 9/Flag Demo:R99", flag: "open-plan-merge", action: "accept" },
    ];
    expect(applyResolutions(levels, ghost)).toEqual({
      levels,
      applied: 0,
      remapped: 0,
      orphaned: 1,
    });
  });

  it("serializes v2 provenance deterministically and detects an older takeoff", () => {
    const file = toResolutionsFile(
      [
        {
          candidateKey: "L:R01",
          flag: "seedless",
          action: "accept",
          anchor: { label: [5, 5], sqft: 100 },
        },
      ],
      { Z: "hash-z", A: "hash-a" },
    );

    expect(file.version).toBe(2);
    expect(Object.keys(file.tsvSha256!)).toEqual(["A", "Z"]);
    expect(JSON.stringify(file)).not.toContain("timestamp");
    expect(provenanceMismatch(file, { A: "hash-a", Z: "hash-z" })).toBe(false);
    expect(provenanceMismatch(file, { A: "changed", Z: "hash-z" })).toBe(true);
    expect(toResolutionsFile(file.resolutions, {}, 1)).toEqual({
      version: 1,
      resolutions: file.resolutions,
    });
  });

  it("replays a rejection after its detector flag disappears", () => {
    const level = parseFlaggedUnitTakeoff();
    const room = level.rooms[0]!;
    delete room.flags;
    const result = applyResolutions(
      [level],
      [
        {
          candidateKey: candidateKey(level.levelName, room.id),
          flag: "open-plan-merge",
          action: "reject",
        },
      ],
    );
    expect(result.levels[0]!.rooms.map(({ id }) => id)).toEqual(["R02", "R03"]);
    expect(result.levels[0]!.residues.map(({ id }) => id)).toEqual(["R01"]);
    expect(result.applied).toBe(1);
  });

  it("counts a retired split/merge/claim decision as an orphan, never a silent drop", () => {
    const result = applyResolutions(
      [parseFlaggedUnitTakeoff()],
      [
        {
          candidateKey: "Level 9/Flag Demo:R01",
          flag: "open-plan-merge",
          action: "split",
          params: { a: [20, 0], b: [20, 30] },
          anchor: { label: [20, 15], sqft: 1200 },
        },
      ],
      2,
    );
    expect(result).toMatchObject({ applied: 0, remapped: 0, orphaned: 1 });
    expect(result.levels[0]!.rooms.map(({ id }) => id)).toEqual(["R01", "R02", "R03"]);
  });

  it("remaps v2 resolutions by geometric anchor and reports every orphan", () => {
    const fixture = JSON.parse(readFileSync(ANCHOR_FIXTURE, "utf8")) as {
      beforeTsv: string;
      afterTsv: string;
      sidecar: { version: 2; resolutions: FlagResolution[] };
      expected: {
        applied: number;
        remapped: number;
        orphaned: number;
        roomIds: string[];
        roomSqft: number[];
        roomLabels: [number, number][];
        rejectedRoomId: string;
      };
    };

    const before = applyResolutions(
      [parseTakeoffTsv(fixture.beforeTsv)],
      fixture.sidecar.resolutions,
      fixture.sidecar.version,
    );
    expect({
      applied: before.applied,
      remapped: before.remapped,
      orphaned: before.orphaned,
    }).toEqual({ applied: 2, remapped: 0, orphaned: 1 });

    const result = applyResolutions(
      [parseTakeoffTsv(fixture.afterTsv)],
      fixture.sidecar.resolutions,
      fixture.sidecar.version,
    );

    expect({
      applied: result.applied,
      remapped: result.remapped,
      orphaned: result.orphaned,
      roomIds: result.levels[0]!.rooms.filter((room) => !room.rejected).map((room) => room.id),
      roomSqft: result.levels[0]!.rooms.filter((room) => !room.rejected).map(
        (room) => room.rawSqft,
      ),
      roomLabels: result.levels[0]!.rooms.filter((room) => !room.rejected).map(
        (room) => room.label,
      ),
      rejectedRoomId: result.levels[0]!.residues.find(
        (residue) => residue.reason === "rejected" && residue.claimed,
      )!.id,
    }).toEqual(fixture.expected);
    expect(result.applied + result.remapped + result.orphaned).toBe(
      fixture.sidecar.resolutions.length,
    );
  });
});
