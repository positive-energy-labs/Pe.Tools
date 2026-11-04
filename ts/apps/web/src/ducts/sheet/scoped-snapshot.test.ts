/** An ids read draws under one sheet group; absence never claims native evidence. */
import { expect, it } from "vite-plus/test";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { schemas } from "../neutral.ts";
import { snapshot as networkSnapshot } from "../test-fixture.ts";
import { indexOf, sceneOf } from "../scene.ts";
import { EMPTY_SNAPSHOT, SHEET_GROUP, sheetSnapshot } from "./scoped-snapshot.ts";

it("a raw ids read draws every element under the one sheet group", () => {
  const raw = {
    ...networkSnapshot,
    nodes: networkSnapshot.nodes.slice(0, 2).map((node, i) => ({ ...node, id: i + 1, groupId: null })),
    segments: networkSnapshot.segments.slice(0, 1).map(segment => ({ ...segment, id: 3, groupId: null })),
  };
  const snapshot = sheetSnapshot(raw);
  expect(snapshot.groups.map((g) => g.id)).toEqual([SHEET_GROUP]);
  const scene = sceneOf(indexOf(snapshot), [SHEET_GROUP], () => true);
  expect(scene.nodes.map((n) => n.node.id).sort()).toEqual([1, 2]);
  expect(scene.segments.map((s) => s.segment.id)).toEqual([3]);
});

it("decodes absence separately and keeps native timestamp validation strict", () => {
  expect(schemas.sheetSnapshot.parse({ kind: "absent" })).toEqual({ kind: "absent" });
  expect(schemas.sheetSnapshot.safeParse(EMPTY_SNAPSHOT).success).toBe(false);
  const native = { ...networkSnapshot, document: { ...networkSnapshot.document, readAt: "2026-11-04T13:25:39.031595+00:00" } };
  expect(nativeResponseSchema("ducts.snapshot.walk").safeParse(native).success).toBe(true);
  expect(schemas.sheetSnapshot.safeParse(native).success).toBe(true);
});
