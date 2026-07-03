import { expect, test } from "vite-plus/test";

import { findAmbiguousBlockIds } from "#/grounded-doc/ambiguous";
import type { GroundedBlock } from "#/grounded-doc/types";

function block(id: string, page: number, bbox: [number, number, number, number]): GroundedBlock {
  const [x, y, w, h] = bbox;
  return { id, page, kind: "table", md: id, bboxes: [{ x, y, w, h }] };
}

test("flags two blocks sharing a near-identical bbox (the page-6 RSD/Env case)", () => {
  const flagged = findAmbiguousBlockIds([
    block("rsd", 6, [25, 300, 560, 401]),
    block("env", 6, [26, 301, 559, 400]), // within tolerance of rsd
    block("mech", 6, [25, 505, 559, 122]), // distinct → clean
  ]);
  expect([...flagged].sort()).toEqual(["env", "rsd"]);
});

test("does not flag distinct bboxes, or matching bboxes on different pages", () => {
  expect(
    findAmbiguousBlockIds([block("a", 1, [0, 0, 10, 10]), block("b", 1, [0, 50, 10, 10])]).size,
  ).toBe(0);
  // same box, different page → not ambiguous
  expect(
    findAmbiguousBlockIds([block("a", 1, [0, 0, 10, 10]), block("b", 2, [0, 0, 10, 10])]).size,
  ).toBe(0);
});
