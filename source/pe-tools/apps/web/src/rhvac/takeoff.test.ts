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

  it("simplifies staircase outlines: area preserved, vertices collapsed, rings stay simple", () => {
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

    let rawVertices = 0;
    let simplifiedVertices = 0;
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
        rawVertices += before.outer.length;
        simplifiedVertices += after.outer.length;
      }
    }
    // Staircases of hundreds of points must come back as tens of segments.
    expect(simplifiedVertices).toBeLessThan(rawVertices * 0.25);
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
