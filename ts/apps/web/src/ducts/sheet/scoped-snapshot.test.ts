/** The sheet's `ids` read joins one group so the picture draws it; no read is the empty snapshot. */
import { expect, it } from "vite-plus/test";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { indexOf, sceneOf } from "../scene";
import { EMPTY_SNAPSHOT, SHEET_GROUP, sheetSnapshot } from "./scoped-snapshot";

it("a raw ids read draws every element under the one sheet group", () => {
  const raw = {
    ...EMPTY_SNAPSHOT,
    nodes: [
      { id: 1, kind: "equipment", groupId: null, connectors: [], facts: [], point: [0, 0, 0] },
      { id: 2, kind: "terminal", groupId: null, connectors: [], facts: [], point: [1, 0, 0] },
    ],
    segments: [{ id: 3, groupId: null, polyline: [[0, 0, 0], [1, 0, 0]], connectors: [] }],
  } as unknown as DuctSnapshot;
  const snapshot = sheetSnapshot(raw);
  expect(snapshot.groups.map((g) => g.id)).toEqual([SHEET_GROUP]);
  const scene = sceneOf(indexOf(snapshot), [SHEET_GROUP], () => true);
  expect(scene.nodes.map((n) => n.node.id).sort()).toEqual([1, 2]);
  expect(scene.segments.map((s) => s.segment.id)).toEqual([3]);
  expect(sheetSnapshot(null)).toBe(EMPTY_SNAPSHOT);
});
