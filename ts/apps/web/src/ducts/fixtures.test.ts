import { expect, test } from "vite-plus/test";
import { seedBodies } from "./fixtures.ts";
import { LAYOUT_FIXTURE } from "./layout.fixture.ts";
import { sheetValueFixtures } from "./sheet/value-fixtures.ts";

test("scene pairs the existing system-bearing scene with fans present in its snapshot", () => {
  const { readings } = seedBodies.seedScene.run();
  expect(readings.roster.systems).toEqual(LAYOUT_FIXTURE.snapshot.systems);
  const units = new Set(readings.sheetSnapshot.nodes.map((node) => node.id));
  expect(readings.fans.rows.length).toBeGreaterThan(0);
  expect(readings.fans.rows.every((row) => units.has(row.unitId))).toBe(true);
  const fans = sheetValueFixtures.scene!({ fan: "all" }).value.data;
  expect(fans.sheetSnapshot).toEqual(readings.sheetSnapshot);
  if (!fans.fans) throw Error("Scene fan roster is missing");
  expect(fans.fans.rows).toEqual(readings.fans.rows);
});
