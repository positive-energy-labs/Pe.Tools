import { expect, test } from "vite-plus/test";
import { partitionRunSchema } from "@pe/agent-contracts";
import type { TakeoffsPartition } from "@pe/host-contracts/generated";

// The generated type is the C# wire; the hand-written reader must accept exactly what it sends.
const live = {
  levelName: "Level 1/Main Level",
  elevation: 348,
  created: 3,
  held: 1,
  rebound: 0,
  orphaned: 0,
  promotion: { accepted: 3, held: 1, strict: false },
  domainSqft: 1200,
  excludedSqft: 80,
  voidSqft: 20,
  totalSqft: 1100,
  enclosureSource: "RoomBoundaries",
  hold: "one region lacks a door",
  failures: [],
  rooms: [],
  residues: [],
  regions: [],
} satisfies TakeoffsPartition.Res.Response;

test("a live partition response parses with its named areas, enclosure source, and hold", () => {
  expect(partitionRunSchema.parse(live)).toMatchObject({
    excludedSqft: 80,
    voidSqft: 20,
    enclosureSource: "RoomBoundaries",
    hold: "one region lacks a door",
  });
  expect(partitionRunSchema.parse({ ...live, hold: null }).hold).toBeNull();
});
