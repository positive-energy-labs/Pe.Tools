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

it("ducts: Pea proposes a ruling on an inference finding but only a person stages it", () => {
  // Inference may compute, never conclude (pressure-drop ledger, 2026-10-19): a proposal never
  // promotes a provisional result; only the person's staged verdict does.
  const spec = ductsRouteState as unknown as RouteStateSpec<z.ZodType>;
  const envelope: RouteEnvelope<unknown> = { version: 1, revision: 0, doc: spec.schema.parse({}) };
  const key = "proximity:8911461:0|10922066:1";
  for (const verdict of ["connect", "ignore"]) {
    const value = { kind: "verdict", verdict };
    const propose = transitionPatches(
      ["assumptions"],
      key,
      {},
      { kind: "propose", rung: { value } },
    );
    expect(applyPatches(spec, envelope, "agent", propose, 0)).toMatchObject({ ok: true });
    const stage = transitionPatches(["assumptions"], key, {}, { kind: "stage", rung: { value } });
    expect(applyPatches(spec, envelope, "agent", stage, 0)).toMatchObject({
      ok: false,
      kind: "refused",
    });
    expect(applyPatches(spec, envelope, "human", stage, 0)).toMatchObject({ ok: true });
  }
});

it("ducts: Pea proposes rules and drops but never stages them, and never touches parameter slots", () => {
  const spec = ductsRouteState as unknown as RouteStateSpec<z.ZodType>;
  const envelope: RouteEnvelope<unknown> = { version: 1, revision: 0, doc: spec.schema.parse({}) };
  const cases = [
    ["rules", "tap-std", { table: "SD5-10" }],
    ["terminalDrops", "31", { inWg: 0.08, source: "catalog p. 12" }],
    ["componentDrops", "22", { inWg: 0.05 }],
    ["ruleAssignments", "Flex Connector", { rule: "damper" }],
    ["esp", "40", { inWg: 1.25 }],
    ["equipmentFlows", "40", { cfm: 4200, source: "submittal p. 3" }],
    ["roles", "40", { role: "fan" }],
    ["roles", "41", { role: "passive" }],
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

it("ducts scene: Pea proposes the subject, claims, label parameter and working phase but never stages them; a verdict is staged by a person", () => {
  const spec = ductsRouteState as unknown as RouteStateSpec<z.ZodType>;
  const envelope: RouteEnvelope<unknown> = { version: 1, revision: 0, doc: spec.schema.parse({}) };
  const claim = {
    title: "Run accessory",
    text: "the damper is the only accessory on the run",
    ids: [14607308],
    state: "proven",
  };
  const cases = [
    [["subject"], "g14122436", [14122436, 14199815, 14199813]],
    [["claims"], "c1", claim],
    [[], "labelParameter", "PE_Equipment_Name"],
    [[], "labelParameter", null],
    [[], "workingPhase", "Existing"],
    [[], "workingPhase", null],
  ] as const;
  for (const [path, key, value] of cases) {
    const propose = transitionPatches(path, key, {}, { kind: "propose", rung: { value } });
    expect(applyPatches(spec, envelope, "agent", propose, 0), key).toMatchObject({ ok: true });
    const stage = transitionPatches(path, key, {}, { kind: "stage", rung: { value } });
    expect(applyPatches(spec, envelope, "agent", stage, 0), key).toMatchObject({ ok: false });
    expect(applyPatches(spec, envelope, "human", stage, 0), key).toMatchObject({ ok: true });
  }
  // A proposed claim carries no verdict; the staged claim with one is the verdict record.
  const judged = {
    ...claim,
    verdict: "not-this",
    verdictBy: "kaitpw",
    verdictAt: "2026-10-19T00:00:00Z",
  };
  const proposeJudged = transitionPatches(
    ["claims"],
    "c2",
    {},
    { kind: "propose", rung: { value: judged } },
  );
  expect(applyPatches(spec, envelope, "agent", proposeJudged, 0)).toMatchObject({ ok: false });
  const stageJudged = transitionPatches(
    ["claims"],
    "c2",
    {},
    { kind: "stage", rung: { value: judged } },
  );
  expect(applyPatches(spec, envelope, "human", stageJudged, 0)).toMatchObject({ ok: true });
  // verdictBy without a verdict, an empty subject, and an unknown state refuse.
  const orphanBy = transitionPatches(
    ["claims"],
    "c3",
    {},
    { kind: "stage", rung: { value: { ...claim, verdictBy: "kaitpw" } } },
  );
  expect(applyPatches(spec, envelope, "human", orphanBy, 0)).toMatchObject({ ok: false });
  const empty = transitionPatches(["subject"], "g1", {}, { kind: "stage", rung: { value: [] } });
  expect(applyPatches(spec, envelope, "human", empty, 0)).toMatchObject({ ok: false });
  const guessed = transitionPatches(
    ["claims"],
    "c4",
    {},
    { kind: "stage", rung: { value: { ...claim, state: "guessed" } } },
  );
  expect(applyPatches(spec, envelope, "human", guessed, 0)).toMatchObject({ ok: false });
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
