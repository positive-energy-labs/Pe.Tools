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

it("ducts: Pea proposes rules and drops but never stages them, and never touches parameter slots", () => {
  const spec = ductsRouteState as unknown as RouteStateSpec<z.ZodType>;
  const envelope: RouteEnvelope<unknown> = { version: 1, revision: 0, doc: spec.schema.parse({}) };
  const cases = [
    ["rules", "tap-std", { table: "SD5-10" }],
    ["terminalDrops", "31", { inWg: 0.08, source: "catalog p. 12" }],
    ["componentDrops", "22", { inWg: 0.05 }],
    ["unitStatics", "40", { inWg: 1.25 }],
  ] as const;
  for (const [segment, key, value] of cases) {
    const propose = transitionPatches([segment], key, {}, { kind: "propose", rung: { value } });
    expect(applyPatches(spec, envelope, "agent", propose, 0), segment).toMatchObject({ ok: true });
    const stage = transitionPatches([segment], key, {}, { kind: "stage", rung: { value } });
    expect(applyPatches(spec, envelope, "agent", stage, 0), segment).toMatchObject({ ok: false });
    expect(applyPatches(spec, envelope, "human", stage, 0), segment).toMatchObject({ ok: true });
  }
  const slot = (kind: "propose" | "stage") =>
    transitionPatches(["parameters"], "fanStatic", {}, { kind, rung: { value: "PE_ESP" } });
  expect(applyPatches(spec, envelope, "agent", slot("propose"), 0)).toMatchObject({ ok: false });
  expect(applyPatches(spec, envelope, "human", slot("stage"), 0)).toMatchObject({ ok: true });
  // A drop is keyed by element id and a slot by its name; anything else refuses.
  const badDrop = transitionPatches(
    ["terminalDrops"],
    "grille",
    {},
    { kind: "stage", rung: { value: { inWg: 0.1 } } },
  );
  expect(applyPatches(spec, envelope, "human", badDrop, 0)).toMatchObject({ ok: false });
  const badSlot = transitionPatches(
    ["parameters"],
    "fanSpeed",
    {},
    { kind: "stage", rung: { value: "X" } },
  );
  expect(applyPatches(spec, envelope, "human", badSlot, 0)).toMatchObject({ ok: false });
});

it("ducts: a unit static is keyed by element id and holds a non-negative in-wg", () => {
  const spec = ductsRouteState as unknown as RouteStateSpec<z.ZodType>;
  const envelope: RouteEnvelope<unknown> = { version: 1, revision: 0, doc: spec.schema.parse({}) };
  const stage = (key: string, inWg: number) =>
    transitionPatches(["unitStatics"], key, {}, { kind: "stage", rung: { value: { inWg } } });
  expect(applyPatches(spec, envelope, "human", stage("40", 1.25), 0)).toMatchObject({ ok: true });
  expect(applyPatches(spec, envelope, "human", stage("rtu", 1.25), 0)).toMatchObject({ ok: false });
  expect(applyPatches(spec, envelope, "human", stage("40", -1), 0)).toMatchObject({ ok: false });
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
