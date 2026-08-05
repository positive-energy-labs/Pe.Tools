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
import { applyResolutions, splitShape, type FlagResolution } from "./resolutions";
import {
  deriveGridPitch,
  levelBounds,
  parseTakeoffTsv,
  shapeCentroid,
  shapePathD,
} from "./takeoff";
import { candidateKey, normalizeExtract, type RhvacExtract, type RoomMap } from "./types";

const FIXTURE_DIR = join(import.meta.dirname, "../../public/rhvac-fixture");

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

/** Basic O(n^2) check: any two non-adjacent ring edges properly crossing. */
function selfIntersects(ring: [number, number][]): boolean {
  const n = ring.length;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (let i = 0; i < n; i++) {
    const [a, b] = [ring[i]!, ring[(i + 1) % n]!];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue; // adjacent
      const [c, d] = [ring[j]!, ring[(j + 1) % n]!];
      const d1 = cross(a, b, c);
      const d2 = cross(a, b, d);
      const d3 = cross(c, d, a);
      const d4 = cross(c, d, b);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
        return true;
    }
  }
  return false;
}

describe("rhvac fixture lane", () => {
  const levels = manifest.takeoff.map((name) => parseTakeoffTsv(readFixture(name)));
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
  });

  it("simplifies fixture outlines without area drift, added vertices, or invalid rings", () => {
    const loopArea = (loop: [number, number][]) => {
      let sum = 0;
      for (let i = 0; i < loop.length; i++) {
        const [x0, y0] = loop[i]!;
        const [x1, y1] = loop[(i + 1) % loop.length]!;
        sum += x0 * y1 - x1 * y0;
      }
      return sum / 2;
    };
    const shapeArea = (outer: [number, number][], holes: [number, number][][]) =>
      loopArea(outer) - holes.reduce((sum, hole) => sum + Math.abs(loopArea(hole)), 0);

    for (const name of manifest.takeoff) {
      const raw = parseTakeoffTsv(readFixture(name), { simplify: false });
      const simplified = parseTakeoffTsv(readFixture(name));
      const pitch = deriveGridPitch(raw.rooms.flatMap((r) => [r.outer, ...r.holes]));
      expect(pitch).not.toBeNull();
      expect(pitch!).toBeLessThanOrEqual(1);

      expect(simplified.rooms).toHaveLength(raw.rooms.length);
      for (let i = 0; i < raw.rooms.length; i++) {
        const before = raw.rooms[i]!;
        const after = simplified.rooms[i]!;
        // Area is the exported truth — simplification must not drift it materially.
        const areaBefore = shapeArea(before.outer, before.holes);
        const areaAfter = shapeArea(after.outer, after.holes);
        expect(Math.abs(areaAfter - areaBefore)).toBeLessThanOrEqual(
          Math.max(0.5, 0.01 * Math.abs(areaBefore)),
        );
        expect(after.outer.length).toBeLessThanOrEqual(before.outer.length);
        expect(selfIntersects(after.outer)).toBe(false);
        for (const hole of after.holes) expect(selfIntersects(hole)).toBe(false);
      }
    }
  });

  it("derives pitch from repeated raster steps, not micro snaps or long walls", () => {
    const cleanSquares: [number, number][][] = Array.from({ length: 100 }, (_, index) => {
      const x = index * 20;
      return [
        [x, 0],
        [x + 10, 0],
        [x + 10, 10],
        [x, 10],
      ];
    });
    const rasterWithMicroSnap: [number, number][] = [
      [0, 0],
      [0.000005, 0],
      [0.250005, 0],
      [0.500005, 0],
      [0.750005, 0],
      [1.000005, 0],
      [1.000005, 0.25],
      [1.000005, 0.5],
      [0, 0.5],
    ];

    expect(deriveGridPitch([...cleanSquares, rasterWithMicroSnap])).toBe(0.25);
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

describe("ambiguity flags + resolutions", () => {
  const loopArea = (loop: [number, number][]) => {
    let sum = 0;
    for (let i = 0; i < loop.length; i++) {
      const [x0, y0] = loop[i]!;
      const [x1, y1] = loop[(i + 1) % loop.length]!;
      sum += x0 * y1 - x1 * y0;
    }
    return Math.abs(sum / 2);
  };

  it("parses real META flag lines from the Partition fixture", () => {
    const level = parseTakeoffTsv(readFixture("rooms_Level_1_Main_Level.tsv"));
    expect(level.levelName).toBe("Level 1/Main Level");
    const byId = new Map(level.rooms.map((r) => [r.id, r]));
    expect(byId.get("R03")!.flags).toEqual(["low-evidence-boundary", "open-plan-merge"]);
    expect(byId.get("R13")!.flags).toEqual(["low-evidence-boundary"]);
    expect(level.rooms.filter((room) => room.flags?.length).length).toBe(10);
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

  const square = () => {
    const level = parseFlaggedUnitTakeoff();
    return level.rooms.find((r) => r.id === "R01")!; // 40x30 at origin
  };

  it("splitShape bisects by a chord: areas sum, both halves simple, naming deterministic", () => {
    const room = square();
    const halves = splitShape(room, [15, 0], [15, 30]);
    expect(halves).not.toBeNull();
    const [a, b] = halves!;
    expect(a.id).toBe("R01.a");
    expect(b.id).toBe("R01.b");
    expect(a.splitFrom).toBe("R01");
    // .a is the larger half (25x30 vs 15x30).
    expect(a.rawSqft).toBeCloseTo(750, 6);
    expect(b.rawSqft).toBeCloseTo(450, 6);
    expect(a.rawSqft + b.rawSqft).toBeCloseTo(room.rawSqft, 6);
    for (const half of halves!) {
      expect(half.outer.length).toBeGreaterThanOrEqual(3);
      expect(selfIntersects(half.outer)).toBe(false);
      expect(loopArea(half.outer)).toBeCloseTo(half.rawSqft, 6);
      expect(half.meanCeilingFt).toBe(room.meanCeilingFt);
    }
    // Snapping: off-boundary clicks land on the ring, so the same chord replays.
    const snapped = splitShape(room, [15, -3], [15, 33]);
    expect(snapped![0]!.rawSqft).toBeCloseTo(750, 6);
  });

  it("splitShape refuses degenerate chords", () => {
    const room = square();
    expect(splitShape(room, [15, 0], [15, 0])).toBeNull(); // same point
    expect(splitShape(room, [10, 0], [10.001, 0])).toBeNull(); // sliver on one edge
  });

  it("applyResolutions is idempotent and durable across re-parse", () => {
    const parse = () => [parseFlaggedUnitTakeoff()];
    const resolutions: FlagResolution[] = [
      {
        candidateKey: "Level 9/Flag Demo:R01",
        flag: "open-plan-merge",
        action: "split",
        params: { a: [20, 0], b: [20, 30] },
      },
      { candidateKey: "Level 9/Flag Demo:R02", flag: "open-plan-merge", action: "accept" },
    ];
    const once = applyResolutions(parse(), resolutions);
    const twice = applyResolutions(once, resolutions);
    expect(twice).toEqual(once);
    // Replaying against a fresh parse of the same TSV yields the same rooms.
    expect(applyResolutions(parse(), resolutions)).toEqual(once);

    const rooms = new Map(once[0]!.rooms.map((r) => [r.id, r]));
    expect(rooms.has("R01")).toBe(false); // split replaced it
    expect(rooms.get("R01.a")!.rawSqft + rooms.get("R01.b")!.rawSqft).toBeCloseTo(1200, 6);
    expect(rooms.get("R01.a")!.flags).toBeUndefined();
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
    expect(applyResolutions(levels, ghost)).toEqual(levels);
  });
});
