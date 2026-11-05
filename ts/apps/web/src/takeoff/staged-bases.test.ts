import { expect, test } from "vite-plus/test";
import { applyPatches, cellPatches, takeoffEditKey, takeoffsRouteState } from "@pe/agent-contracts";
import { projectMockModel } from "./proto/project-model";
import { mockModel } from "./proto/mock";
import { roomEdit, withEditBases } from "./projections";

test.each(["human", "pea"] as const)(
  "%s set captures the observed base once; clear does not invent one",
  (by) => {
    const world = projectMockModel(mockModel());
    const room = world.zones.flatMap((zone) => zone.rooms)[0]!;
    const key = takeoffEditKey(room.guid, "ceilingFt");
    const doc = takeoffsRouteState.schema.parse({});
    const patches = withEditBases(
      doc,
      world,
      cellPatches(["edits"], key, {}, { kind: "set", rung: { value: 12 } }),
    );
    const landed = applyPatches(
      takeoffsRouteState,
      { version: 1, revision: 0, doc },
      by,
      patches,
      0,
    );
    if (!landed.ok) throw Error(landed.error);
    expect(landed.envelope.doc.bases[room.guid]).toEqual(roomEdit(room));
    expect(landed.envelope.doc.edits[key]?.edit).toMatchObject({ value: 12, by });
    const clear = cellPatches(["edits"], key, {}, { kind: "clear" });
    expect(withEditBases(doc, world, clear)).toEqual(clear);
    expect(withEditBases(landed.envelope.doc, world, patches.slice(-1))).toEqual(patches.slice(-1));
  },
);
