import type { Verdict } from "#/takeoff/atlas";
import type { RoomData, WorldRoom, WorldZone } from "#/takeoff/world";

export const MANUAL_J: { field: keyof RoomData; label: string; width: string }[] = [
  { field: "people", label: "ppl", width: "w-12" },
  { field: "lightingW", label: "ltg W", width: "w-16" },
  { field: "equipSensible", label: "eq S", width: "w-16" },
  { field: "equipLatent", label: "eq L", width: "w-16" },
  { field: "ventilationCfm", label: "vent", width: "w-16" },
];

export const decideReason = (live: boolean, room: WorldRoom, verb: Verdict): string =>
  !live
    ? `Marks this call ${verb === "accept" ? "accepted" : "dismissed"} for this session only (fixture)`
    : room.elementId === null
      ? "no Room Region home yet — partition must materialize this room before a verdict can be written"
      : `Writes the ${verb} onto this room's Room Region provenance blob in the live model`;

export const hostReason = (
  live: boolean,
  busy: string | null,
  does: string,
  onFixture: string,
): string => (!live ? onFixture : busy !== null ? `${busy} is in flight` : does);

export const PLAN_MIN_SQFT = 60;
export const onPlan = (zone: WorldZone) => zone.zone.declaredSqft >= PLAN_MIN_SQFT;
