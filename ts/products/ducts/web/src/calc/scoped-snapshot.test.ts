/** An ids read draws under one sheet group; absence never claims native evidence. */
import { expect, it } from "vite-plus/test";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { fansCalcData } from "@pe/agent-contracts";
import { snapshot as networkSnapshot } from "../test-fixture.ts";
import { indexOf, sceneOf } from "../scene.ts";
import { EMPTY_SNAPSHOT, CALC_GROUP, calcSnapshot, calcSystems } from "./scoped-snapshot.ts";

it("a raw ids read draws every element under the one sheet group", () => {
  const raw = {
    ...networkSnapshot,
    nodes: networkSnapshot.nodes.slice(0, 2).map((node, i) => ({ ...node, id: i + 1, groupId: null })),
    segments: networkSnapshot.segments.slice(0, 1).map(segment => ({ ...segment, id: 3, groupId: null })),
  };
  const snapshot = calcSnapshot(raw);
  expect(snapshot.groups.map((g) => g.id)).toEqual([CALC_GROUP]);
  const scene = sceneOf(indexOf(snapshot), [CALC_GROUP], () => true);
  expect(scene.nodes.map((n) => n.node.id).sort()).toEqual([1, 2]);
  expect(scene.segments.map((s) => s.segment.id)).toEqual([3]);
});

it("decodes absence separately and keeps native timestamp validation strict", () => {
  expect(fansCalcData.shape.calcSnapshot.parse({ kind: "absent" })).toEqual({ kind: "absent" });
  expect(fansCalcData.shape.calcSnapshot.safeParse(EMPTY_SNAPSHOT).success).toBe(false);
  const native = { ...networkSnapshot, document: { ...networkSnapshot.document, readAt: "2026-11-04T13:25:39.031595+00:00" } };
  expect(nativeResponseSchema("ducts.snapshot.walk").safeParse(native).success).toBe(true);
  expect(fansCalcData.shape.calcSnapshot.safeParse(native).success).toBe(true);
});

it("owner links scope only canonical roster entries and omit scope for bounded ids snapshots", () => {
  const bounded = { ...networkSnapshot, systems: [], nodes: networkSnapshot.nodes.map(node => ({ ...node, systemName: "SA 20,RA 37" })) };
  expect(calcSystems(bounded)).toEqual([]);
  const canonical = { ...bounded, systems: networkSnapshot.systems };
  expect(calcSystems(canonical)).toEqual(networkSnapshot.systems.map(system => system.name));
});
