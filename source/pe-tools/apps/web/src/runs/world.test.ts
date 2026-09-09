// The honesty seams of the /runs data layer: the persisted ROOM disposition column (SHIMS.md #3),
// stable-key A/B pairing with name-pairing only as a surfaced fallback (SHIMS.md #2), the
// two-currency scores.json reading (SHIMS.md #1), and partial-run detection (the 20260817-161144
import { describe, expect, it } from "vite-plus/test";

import {
  classesPathForSeals,
  boardSummary,
  comparableRuns,
  difference,
  modalZoneCount,
  pairZones,
  parseReplaySeedInk,
  parseZoneTsv,
  partiality,
  planCanvasTransform,
  planSidecarPaths,
  reportKeyed,
  replayPathForInk,
  type RunReport,
  type RunScores,
  scoreBoards,
  type ZoneRecord,
} from "./world";

describe("registered plan substrate", () => {
  it("derives the plan sidecars and maps native plan pixels into the zone viewport", () => {
    expect(planSidecarPaths("input/ink_Level_0_Lower_Level.bin")).toEqual({
      image: "input/plan_Level_0_Lower_Level.png",
      registration: "input/plan_Level_0_Lower_Level.json",
    });
    expect(classesPathForSeals("input/seals_Level_0_Lower_Level.bin")).toBe(
      "input/classes_Level_0_Lower_Level.bin",
    );
    expect(
      planCanvasTransform(
        {
          width: 100,
          height: 200,
          topLeft: [10, 40],
          topRight: [30, 40],
          bottomLeft: [10, 0],
        },
        { minX: 0, minY: 0, maxX: 50, maxY: 50, pxPerFt: 2, widthPx: 100, heightPx: 100 },
      ),
    ).toEqual([0.4, -0, 0, 0.4, 20, 20]);
  });
});

describe("replay seed ink", () => {
  it("reads the solver's SKAT seed bits and derives the replay path from the legacy Ink locator", () => {
    expect(replayPathForInk("input/ink_Lower_Level.bin")).toBe("input/replay_Lower_Level.bin");

    const buffer = new ArrayBuffer(86);
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let offset = 0;
    const u32 = (value: number) => {
      view.setUint32(offset, value, true);
      offset += 4;
    };
    const i32 = (value: number) => {
      view.setInt32(offset, value, true);
      offset += 4;
    };
    const f64 = (value: number) => {
      view.setFloat64(offset, value, true);
      offset += 8;
    };
    const text = (value: string) => {
      const encoded = new TextEncoder().encode(value);
      bytes[offset++] = encoded.length;
      bytes.set(encoded, offset);
      offset += encoded.length;
    };
    u32(0x54414b53);
    i32(1);
    text("L");
    f64(12);
    text("{}");
    i32(2);
    i32(2);
    f64(1);
    f64(2);
    f64(0.25);
    offset += 32;
    bytes[offset] = 0b1010;

    const raster = parseReplaySeedInk(buffer);
    expect(raster).toMatchObject({ w: 2, h: 2, minX: 1, minY: 2, cellFt: 0.25 });
    expect([...raster.bits]).toEqual([0b1010]);
  });
});

const TSV = [
  "META\tlevel\tL1",
  "META\telev\t0.000000",
  "ROOM\tR01\t100.0\t40.0\t1.000000\t1.000000\t9.00\taccepted",
  "POLY\tR01\touter\t0;0|10;0|10;10|0;10",
  "ROOM\tR02\t50.0\t30.0\t14.000000\t1.000000\t9.00",
  "POLY\tR02\touter\t12;0|18;0|18;8|12;8",
  "META\tresidue\tR03\trejected\t25.0\t22.000000\t1.000000\t9.00\t20;0|25;0|25;5|20;5",
].join("\n");

describe("parseZoneTsv disposition column", () => {
  it("reads the persisted 8th column and leaves its absence UNKNOWN, never accepted", () => {
    const geometry = parseZoneTsv(TSV);
    expect(geometry.rooms.find((room) => room.id === "R01")?.disposition).toBe("accepted");
    expect(geometry.rooms.find((room) => room.id === "R02")?.disposition).toBeNull();
    expect(geometry.residues[0]).toMatchObject({ id: "R03", reason: "rejected" });
  });
});

function zone(over: Partial<ZoneRecord>): ZoneRecord {
  return {
    Level: "Main Level",
    Zone: "Main Level#00",
    triage: { verdict: "solve", reason: "" },
    ...over,
  } as ZoneRecord;
}

function report(zones: ZoneRecord[]): RunReport {
  return { Zones: zones } as RunReport;
}

it("keeps a failed capture unknown, preserves zero, and refuses cross-document pairing", () => {
  const failed = zone({
    Zone: "Main#09",
    zoneKey: "same-zone",
    AcceptedRooms: null,
    AcceptedSqft: null,
    HeldSqft: null,
    triage: { verdict: "error", reason: "overlap" },
  });
  const current = {
    ...report([failed]),
    documentKey: "project-a",
    scopeKey: "scope",
    RejectionHistogram: {},
  };
  const board = boardSummary(current);
  expect(board).toMatchObject({
    errors: 1,
    solved: 0,
    acceptedRooms: null,
    acceptedSqft: null,
    heldSqft: null,
  });
  expect(difference(null, 0)).toBeNull();
  expect(difference(0, 0)).toBe(0);
  const other = { ...current, documentKey: "project-c" };
  expect(comparableRuns(current, other)).toBe(false);
  expect(pairZones(current, other)[0]?.a).toBeNull();
  expect(comparableRuns(current, { ...current })).toBe(true);
  expect(comparableRuns(current, { ...current, scopeKey: "another-loop" })).toBe(false);
  expect(parseZoneTsv("ROOM\tR01\t0\t0\t1\t1\t\theld").rooms[0]).toMatchObject({
    sqft: 0,
    ceil: null,
    disposition: "held",
  });
  expect(
    scoreBoards({ metricSchemaVersion: 4, board: { axes: {} } } as unknown as RunScores),
  ).toEqual({ v11: null, v1: null });
});

describe("pairZones", () => {
  it("pairs on the stable key when both packages carry it — reorderings and renames survive", () => {
    const cur = report([
      zone({ Zone: "Main Level#00", zoneKey: "aaa" }),
      zone({ Zone: "Main Level#01", zoneKey: "bbb" }),
    ]);
    const prev = report([
      zone({ Zone: "Main Level#01", zoneKey: "aaa" }),
      zone({ Zone: "Main Level#00", zoneKey: "bbb" }),
    ]);
    const pairs = pairZones(cur, prev);
    expect(pairs).toHaveLength(2);
    expect(pairs.every((pair) => pair.pairedBy === "key")).toBe(true);
    expect(pairs[0]?.a?.zoneKey).toBe("aaa");
    expect(pairs[0]?.b?.zoneKey).toBe("aaa");
  });

  it("renders orphans as orphans under key pairing — no name rescue", () => {
    const cur = report([zone({ Zone: "Main Level#00", zoneKey: "new" })]);
    const prev = report([zone({ Zone: "Main Level#00", zoneKey: "old" })]);
    const pairs = pairZones(cur, prev);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ a: null, pairedBy: "key" });
    expect(pairs[1]).toMatchObject({ b: null, pairedBy: "key" });
  });

  it("falls back to name pairing when either package predates keys, and says so", () => {
    const cur = report([zone({ Zone: "Main Level#00", zoneKey: "aaa" })]);
    const prev = report([zone({ Zone: "Main Level#00" })]);
    expect(reportKeyed(prev)).toBe(false);
    const pairs = pairZones(cur, prev);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ pairedBy: "name" });
    expect(pairs[0]?.a).not.toBeNull();
  });
});

describe("scoreBoards", () => {
  it("splits the two currencies and never lets a legacy v1 file impersonate v1.1", () => {
    const modern = {
      currency: "v1.1 (cleaned oracle)",
      board: { savedWork: 0.43 },
      boardV1RawOracle: { savedWork: 0.44 },
    } as unknown as RunScores;
    expect(scoreBoards(modern).v11?.savedWork).toBe(0.43);
    expect(scoreBoards(modern).v1?.savedWork).toBe(0.44);

    const legacy = { board: { savedWork: 0.38 } } as unknown as RunScores;
    expect(scoreBoards(legacy).v11).toBeNull();
    expect(scoreBoards(legacy).v1?.savedWork).toBe(0.38);
  });
});

const filteredReport = (zones: number, zoneFilter?: string | null): RunReport => {
  const base = report(Array.from({ length: zones }, (_, i) => zone({ Zone: `Main Level#${i}` })));
  // Absent vs explicit-null is the load-bearing distinction — only spread the key in when given.
  return zoneFilter === undefined ? base : { ...base, zoneFilter };
};

describe("partiality", () => {
  it("declared filter = partial, regardless of zone count", () => {
    expect(partiality(filteredReport(1, "Lower Level#08"), 45)).toEqual({
      kind: "partial",
      zone: "Lower Level#08",
    });
    expect(partiality(filteredReport(45, "Lower Level"), 45).kind).toBe("partial");
  });

  it("explicit null = full, even when the count looks suspicious", () => {
    expect(partiality(filteredReport(1, null), 45)).toEqual({ kind: "full" });
  });

  it("pre-field package below the modal count = possibly partial (161144's lie)", () => {
    expect(partiality(filteredReport(1), 45)).toEqual({
      kind: "possibly-partial",
      zones: 1,
      modal: 45,
    });
  });

  it("pre-field package at the modal count = full", () => {
    expect(partiality(filteredReport(45), 45)).toEqual({ kind: "full" });
  });

  it("unknown modal count disables the heuristic — honest cannot-assess, never a guess", () => {
    expect(partiality(filteredReport(1), null)).toEqual({ kind: "full" });
  });
});

describe("modalZoneCount", () => {
  it("returns the most common zone count", () => {
    expect(modalZoneCount([filteredReport(45), filteredReport(45), filteredReport(1)])).toBe(45);
  });

  it("ties break toward the LARGER count — filtered runs must not vote filtered into full", () => {
    expect(modalZoneCount([filteredReport(1), filteredReport(45)])).toBe(45);
  });

  it("null on an empty pool", () => {
    expect(modalZoneCount([])).toBeNull();
  });
});
