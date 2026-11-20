import {
  takeoffEditAddress,
  type ModelRoom,
  type RoomEdit,
  type RouteStatePatch,
} from "@pe/agent-contracts";

/** Capture the observed room baseline on its first staged set, by either author. */
export function withEditBases(
  doc: { bases: Readonly<Record<string, unknown>> },
  world: { zones: readonly { rooms: readonly ModelRoom[] }[] },
  patches: RouteStatePatch[],
): RouteStatePatch[] {
  const rooms = new Set(
    patches
      .filter(
        (patch) => patch.path[0] === "edits" && patch.path[2] === "edit" && patch.value != null,
      )
      .map((patch) => takeoffEditAddress(String(patch.path[1])).roomId),
  );
  const bases = [...rooms].flatMap((roomId) => {
    const room = world.zones.flatMap((zone) => zone.rooms).find((r) => r.guid === roomId);
    // not a cell: bases
    return doc.bases[roomId] || !room ? [] : [{ path: ["bases", roomId], value: roomEdit(room) }];
  });
  return [...bases, ...patches];
}

export const roomEdit = (room: ModelRoom): RoomEdit => ({
  name: room.name,
  type: room.type,
  ceilingFt: room.ceilingFt,
  people: room.data?.people,
  lightingW: room.data?.lightingW,
  equipSensible: room.data?.equipSensible,
  equipLatent: room.data?.equipLatent,
  ventilationCfm: room.data?.ventilationCfm,
});
