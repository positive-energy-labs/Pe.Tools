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
import { levelBounds, parseTakeoffTsv, shapeCentroid, shapePathD } from "./takeoff";
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
