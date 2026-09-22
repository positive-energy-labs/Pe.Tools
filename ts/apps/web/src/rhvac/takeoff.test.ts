/**
 * Smoke the /rhvac fixture lane against the private project-a data in
 * .private/fixtures/project-a/web (skipped when absent): the TSV parser must accept every committed takeoff
 * snapshot, the room map's candidate keys must resolve to parsed polygons, and
 * the extract must normalize into identifiable rooms with a usable assembly
 * catalog.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { privateFixturesDir } from "../../checkout-paths.ts";
import { describe, expect, it } from "vite-plus/test";

import {
  levelBounds,
  mergeTakeoffLevels,
  parseTakeoffTsv,
  shapeCentroid,
  shapePathD,
} from "./takeoff";
import { candidateKey, normalizeExtract, type RhvacExtract, type RoomMap } from "./types";

const FIXTURE_DIR = join(privateFixturesDir, "project-a/web");
const fixturePresent = existsSync(join(FIXTURE_DIR, "manifest.json"));

const readFixture = (name: string) => {
  const text = readFileSync(join(FIXTURE_DIR, name), "utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
};

const manifest = (
  fixturePresent
    ? JSON.parse(readFixture("manifest.json"))
    : { extract: "", roomMap: "", takeoff: [] }
) as {
  extract: string;
  roomMap: string;
  takeoff: string[];
};

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

const loadLane = () => ({
  levels: mergeTakeoffLevels(manifest.takeoff.map((name) => parseTakeoffTsv(readFixture(name)))),
  extract: normalizeExtract(JSON.parse(readFixture(manifest.extract)) as RhvacExtract),
  roomMap: JSON.parse(readFixture(manifest.roomMap)) as RoomMap,
});

describe.skipIf(!fixturePresent)("rhvac fixture lane", () => {
  // Skipped suites still run their body; only read the private data when it is there.
  const { levels, extract, roomMap } = fixturePresent
    ? loadLane()
    : ({} as ReturnType<typeof loadLane>);

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

  it("normalizes the extract with unique identifiers", () => {
    expect(extract.rooms).toHaveLength(150);
    const identifiers = new Set(extract.rooms.map((room) => room.identifier));
    expect(identifiers.size).toBe(150);
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
});
