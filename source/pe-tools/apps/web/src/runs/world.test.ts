// The honesty seams of the /runs data layer: the persisted ROOM disposition column (SHIMS.md #3),
// stable-key A/B pairing with name-pairing only as a surfaced fallback (SHIMS.md #2), and the
// two-currency scores.json reading (SHIMS.md #1). No solver logic here — parsing and pairing only.
import { describe, expect, it } from "vite-plus/test";

import {
  pairZones,
  parseZoneTsv,
  reportKeyed,
  type RunReport,
  type RunScores,
  scoreBoards,
  type ZoneRecord,
} from "./world";

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
    // 7-column ROOM line = pre-column package: unknown is the only honest reading.
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

describe("pairZones", () => {
  it("pairs on the stable key when both packages carry it — reorderings and renames survive", () => {
    const cur = report([
      zone({ Zone: "Main Level#00", zoneKey: "aaa" }),
      zone({ Zone: "Main Level#01", zoneKey: "bbb" }),
    ]);
    // Same geography, opposite ordinals: name pairing would cross the zones.
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
    const prev = report([zone({ Zone: "Main Level#00" })]); // pre-v4 package
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
