import { describe, expect, it } from "vite-plus/test";

import { applyPatches, type RouteEnvelope } from "./route-doc.ts";
import type { RouteStateSpec } from "./route-state.ts";
import {
  partitionReviewSchema,
  stagedDecisions,
  stagedReviewFlags,
  stagedTakeoffEdits,
  takeoffDecisionKey,
  takeoffDiscardEdits,
  takeoffEditKey,
  takeoffEditPatches,
  takeoffFlagToggle,
  takeoffRegionAnalysisSchema,
  takeoffsRouteState,
  type TakeoffsRouteDocument,
} from "./takeoffs.ts";
import { transitionPatches } from "./trichotomy.ts";
import type { z } from "zod";
import { preparedTakeoffSchema, takeoffActions } from "./semantic-actions.ts";

it("normalizes omitted native analysis nulls without accepting invalid values", () => {
  expect(takeoffRegionAnalysisSchema.parse({ state: "unmeasured" })).toEqual({
    state: "unmeasured",
    runId: null,
    floorZ: null,
    ceilingZ: null,
    hold: null,
  });
  expect(
    takeoffRegionAnalysisSchema.parse({
      state: "current",
      runId: "run",
      floorZ: 0,
      ceilingZ: 9,
    }).hold,
  ).toBeNull();
  expect(takeoffRegionAnalysisSchema.safeParse({ state: "current", hold: 42 }).success).toBe(false);
});

it("freezes Takeoffs decisions and exposes no competing native decision channels", () => {
  expect(
    preparedTakeoffSchema.parse({
      process: {
        pid: 42,
        processStartUtc: "2026-09-14T00:00:00.000Z",
        executable: "C:\\Program Files\\Autodesk\\Revit 2025\\Revit.exe",
      },
      edits: {},
      decisions: { [takeoffDecisionKey("room", "flag")]: "accept" },
    }).decisions,
  ).toEqual({ [takeoffDecisionKey("room", "flag")]: "accept" });
  expect(takeoffActions).not.toHaveProperty("takeoffs.decisions");
  expect(takeoffActions).not.toHaveProperty("takeoffs.room-type");
});

it("reads accepted review shapes when the transport omits a null reason", () => {
  const data = partitionReviewSchema.parse({
    source: { runId: "run", documentKey: "doc", zoneKey: "zone" },
    zone: { key: "zone", name: "zone", loops: [] },
    shapes: [
      { id: "R01", kind: "room", disposition: "accepted", sqft: 10, label: [0, 0], loops: [] },
    ],
  });
  expect(data.shapes[0]!.reason).toBeNull();
});

const spec = takeoffsRouteState as unknown as RouteStateSpec<z.ZodType>;
const empty = (): RouteEnvelope<unknown> => ({
  version: 1,
  revision: 0,
  doc: spec.schema.parse({}),
});
/** Apply as the actor and return the landed document. */
function land(
  doc: unknown,
  actor: "agent" | "human",
  patches: ReturnType<typeof transitionPatches>,
) {
  const result = applyPatches(spec, { version: 1, revision: 0, doc }, actor, patches, 0);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  return (result as { envelope: { doc: TakeoffsRouteDocument } }).envelope.doc;
}

describe("takeoffsRouteState", () => {
  it("defaults a new route document to no authored cells", () => {
    expect(takeoffsRouteState.schema.parse({})).toEqual({
      edits: {},
      bases: {},
      adopt: {},
      decisions: {},
      reviewFlags: {},
    });
  });

  it("refuses the pre-cells shapes strictly: no strip, no silent loss", () => {
    for (const old of [
      { staged: [{ roomId: "room", base: {}, next: { name: "Authored" } }] },
      { adoptPatches: { "v:1": { checked: true } } },
      { stage: "audit" },
    ])
      expect(takeoffsRouteState.schema.safeParse(old).success).toBe(false);
  });

  it("Pea proposes on every cell family and stages none; the person's edit stages per field", () => {
    const room = "room-1";
    const decision = takeoffDecisionKey(room, "seedless");
    const proposed = land(empty().doc, "agent", [
      ...transitionPatches(
        ["decisions"],
        decision,
        {},
        { kind: "propose", rung: { value: "dismiss" } },
      ),
      ...transitionPatches(
        ["adopt"],
        "v:1",
        {},
        { kind: "propose", rung: { value: { checked: true } } },
      ),
    ]);
    expect(stagedDecisions(proposed)).toEqual({});
    expect(
      applyPatches(
        spec,
        { ...empty(), doc: proposed },
        "agent",
        transitionPatches(
          ["decisions"],
          decision,
          {},
          { kind: "stage", rung: { value: "dismiss" } },
        ),
        0,
      ),
    ).toMatchObject({ ok: false, kind: "refused" });
    // A person's edit: a changed field stages, an unchanged one stages nothing, the base sits beside.
    const edited = land(
      proposed,
      "human",
      takeoffEditPatches(
        proposed,
        room,
        { name: "Before", ceilingFt: 9 },
        { name: "After", ceilingFt: 9 },
      ),
    );
    expect(stagedTakeoffEdits(edited)).toEqual({
      [room]: { roomId: room, base: { name: "Before", ceilingFt: 9 }, next: { name: "After" } },
    });
    // A field value its schema refuses cannot be written.
    expect(
      applyPatches(
        spec,
        { ...empty(), doc: edited },
        "human",
        takeoffEditPatches(
          edited,
          room,
          { name: "Before" },
          { name: "After", ceilingFt: "tall" as never },
        ),
        0,
      ),
    ).toMatchObject({ ok: false });
  });

  it("discard unstages every staged room edit and leaves Pea's proposals standing", () => {
    const doc = empty().doc as TakeoffsRouteDocument;
    const edited = land(doc, "human", takeoffEditPatches(doc, "r", { name: "A" }, { name: "B" }));
    const proposed = land(
      edited,
      "agent",
      transitionPatches(
        ["edits"],
        takeoffEditKey("r", "people"),
        {},
        {
          kind: "propose",
          rung: { value: 4 },
        },
      ),
    );
    const discarded = land(proposed, "human", takeoffDiscardEdits(proposed));
    expect(stagedTakeoffEdits(discarded)).toEqual({});
    expect(discarded.edits[takeoffEditKey("r", "people")]?.proposal).toMatchObject({ value: 4 });
  });

  it("unflag clears the staged flag (the old union-only flagReview could never unflag)", () => {
    const flagged = land(
      empty().doc,
      "human",
      takeoffFlagToggle(empty().doc as TakeoffsRouteDocument, "zone", "room:R01"),
    );
    expect(stagedReviewFlags(flagged)).toEqual({ zone: ["room:R01"] });
    const unflagged = land(flagged, "human", takeoffFlagToggle(flagged, "zone", "room:R01"));
    expect(stagedReviewFlags(unflagged)).toEqual({});
  });
});
