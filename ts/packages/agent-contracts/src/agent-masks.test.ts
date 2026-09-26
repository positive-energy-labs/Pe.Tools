/**
 * Every collaborative route is on cells: Pea's mask reaches proposals only, and a staged value is
 * a person's. (Takeoffs has its own cell tests in takeoffs.test.ts.)
 */
import { expect, it } from "vite-plus/test";
import { scheduleGridRouteState } from "./schedule-grid-data.ts";
import { transitionPatches } from "./trichotomy.ts";
import type { z } from "zod";
import { applyPatches, type RouteEnvelope } from "./route-doc.ts";
import type { RouteStateSpec } from "./route-state.ts";
import { instancesRouteState } from "./instances.ts";
import { parameterLinksRouteState } from "./parameter-links.ts";
import { roomsRouteState } from "./rooms.ts";
import { ductsRouteState } from "./ducts.ts";

it("ducts: Pea proposes an assumption, cannot stage it, and a key holding the wrong kind refuses", () => {
  const spec = ductsRouteState as unknown as RouteStateSpec<z.ZodType>;
  const envelope: RouteEnvelope<unknown> = { version: 1, revision: 0, doc: spec.schema.parse({}) };
  const capped = { kind: "verdict", verdict: "capped" };
  const key = "open-end:g12:345:1";
  const propose = transitionPatches(
    ["assumptions"],
    key,
    {},
    { kind: "propose", rung: { value: capped } },
  );
  expect(applyPatches(spec, envelope, "agent", propose, 0)).toMatchObject({ ok: true });
  const stage = transitionPatches(
    ["assumptions"],
    key,
    {},
    { kind: "stage", rung: { value: capped } },
  );
  expect(applyPatches(spec, envelope, "agent", stage, 0)).toMatchObject({
    ok: false,
    kind: "refused",
  });
  expect(applyPatches(spec, envelope, "human", stage, 0)).toMatchObject({ ok: true });
  const wrong = transitionPatches(
    ["assumptions"],
    "fan-static:6034271",
    {},
    {
      kind: "stage",
      rung: { value: capped },
    },
  );
  expect(applyPatches(spec, envelope, "human", wrong, 0)).toMatchObject({ ok: false });
});

it("schedules: Pea proposes a grid cell through the shared contract and cannot stage it", () => {
  const envelope: RouteEnvelope<unknown> = {
    version: 1,
    revision: 0,
    doc: scheduleGridRouteState.schema.parse({}),
  };
  const spec = scheduleGridRouteState as unknown as RouteStateSpec<z.ZodType>;
  const propose = transitionPatches(
    ["cells"],
    "1::2",
    {},
    { kind: "propose", rung: { value: "180 VA" } },
  );
  expect(applyPatches(spec, envelope, "agent", propose, 0)).toMatchObject({ ok: true });
  const stage = transitionPatches(
    ["cells"],
    "1::2",
    {},
    { kind: "stage", rung: { value: "180 VA" } },
  );
  expect(applyPatches(spec, envelope, "agent", stage, 0)).toMatchObject({
    ok: false,
    kind: "refused",
  });
});

it("instances: Pea proposes a launch on the one cell and cannot stage it", () => {
  const spec = instancesRouteState as unknown as RouteStateSpec<z.ZodType>;
  const envelope: RouteEnvelope<unknown> = { version: 1, revision: 0, doc: spec.schema.parse({}) };
  const value = { kind: "start", year: "2025", name: "dev" };
  const propose = transitionPatches([], "launch", {}, { kind: "propose", rung: { value } });
  expect(applyPatches(spec, envelope, "agent", propose, 0)).toMatchObject({ ok: true });
  const stage = transitionPatches([], "launch", {}, { kind: "stage", rung: { value } });
  expect(applyPatches(spec, envelope, "agent", stage, 0)).toMatchObject({
    ok: false,
    kind: "refused",
  });
  expect(applyPatches(spec, envelope, "human", stage, 0)).toMatchObject({ ok: true });
  // The pre-cells shape is not read: strict rejection, never a silent strip.
  expect(spec.schema.safeParse({ staged: value }).success).toBe(false);
});

it("parameter-links: Pea proposes a profile on the one cell and cannot stage it", () => {
  const spec = parameterLinksRouteState as unknown as RouteStateSpec<z.ZodType>;
  const envelope: RouteEnvelope<unknown> = { version: 1, revision: 0, doc: spec.schema.parse({}) };
  const value = {
    formatVersion: 1,
    definitions: [
      {
        id: "d1",
        sourceCategoryId: -2001000,
        sourceParameter: { name: "MCA" },
        sourceScope: "instanceThenType",
        relationship: "sameElement",
        targetParameter: { name: "Load" },
        reducer: "first",
      },
    ],
    assignments: [],
  };
  const propose = transitionPatches([], "profile", {}, { kind: "propose", rung: { value } });
  expect(applyPatches(spec, envelope, "agent", propose, 0)).toMatchObject({ ok: true });
  const stage = transitionPatches([], "profile", {}, { kind: "stage", rung: { value } });
  expect(applyPatches(spec, envelope, "agent", stage, 0)).toMatchObject({
    ok: false,
    kind: "refused",
  });
  expect(applyPatches(spec, envelope, "human", stage, 0)).toMatchObject({ ok: true });
  // The pre-cells `{ draft }` shape is not read: strict rejection, never a silent strip.
  expect(spec.schema.safeParse({ draft: value }).success).toBe(false);
});

it("rooms: Pea proposes a mark and writes a note, cannot stage the mark, and a bad mark refuses", () => {
  const spec = roomsRouteState as unknown as RouteStateSpec<z.ZodType>;
  const envelope: RouteEnvelope<unknown> = { version: 1, revision: 0, doc: spec.schema.parse({}) };
  const anchor = { view: "L1 - Rooms", level: "L1" };
  const value = {
    kind: "merge",
    anchor: {
      ...anchor,
      polygon: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    },
    run: "r1",
  };
  const propose = transitionPatches(["marks"], "m1", {}, { kind: "propose", rung: { value } });
  expect(applyPatches(spec, envelope, "agent", propose, 0)).toMatchObject({ ok: true });
  const stage = transitionPatches(["marks"], "m1", {}, { kind: "stage", rung: { value } });
  expect(applyPatches(spec, envelope, "agent", stage, 0)).toMatchObject({
    ok: false,
    kind: "refused",
  });
  expect(applyPatches(spec, envelope, "human", stage, 0)).toMatchObject({ ok: true });
  const note = {
    anchor: { ...anchor, polygon: [[5, 5]] },
    text: "open plan",
    by: "pea",
    at: "2026-09-25T12:00:00Z",
  };
  expect(
    applyPatches(spec, envelope, "agent", [{ path: ["notes", "n1"], value: note }], 0),
  ).toMatchObject({ ok: true });
  // A mark needs a polygon of three points and a known kind; a note has no rungs.
  const bad = {
    ...value,
    anchor: {
      ...anchor,
      polygon: [
        [0, 0],
        [10, 0],
      ],
    },
  };
  expect(spec.schema.safeParse({ marks: { m1: { staged: { value: bad } } } }).success).toBe(false);
  expect(
    spec.schema.safeParse({ marks: { m1: { staged: { value: { ...value, kind: "delete" } } } } })
      .success,
  ).toBe(false);
  expect(spec.schema.safeParse({ notes: { n1: { proposal: { value: note } } } }).success).toBe(
    false,
  );
});
