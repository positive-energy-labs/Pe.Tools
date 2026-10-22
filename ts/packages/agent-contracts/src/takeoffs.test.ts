import { describe, expect, it } from "vite-plus/test";

import { applyPatches, type RouteEnvelope } from "./route-doc.ts";
import type { RouteStateSpec } from "./route-state.ts";
import {
  stagedDecisions,
  stagedTakeoffEdits,
  takeoffDecisionKey,
  takeoffDiscardEdits,
  takeoffEditKey,
  takeoffEditPatches,
  takeoffsRouteState,
  type TakeoffsRouteDocument,
} from "./takeoffs.ts";
import { transitionPatches } from "./trichotomy.ts";
import type { z } from "zod";

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
});
