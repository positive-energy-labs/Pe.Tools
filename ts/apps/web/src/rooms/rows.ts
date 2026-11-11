import type { RoomsSnapshot } from "@pe/host-contracts/generated";
import { decode, subjectCode } from "@pe/agent-contracts";

/*
 * The room roster, pure: the route's subject options, the table, the plan and the host's Goal all
 * order and label regions here, so `R3` names one region on every surface.
 */
export type RoomsRegion = RoomsSnapshot.Res.RoomsRegion;

/** A region with its label, as the roster orders and numbers it. */
export interface RoomRow {
  region: RoomsRegion;
  label: string;
}

/**
 * The room as a subject: keyKind `region`, the carrier GUID. Not the slot plan's `UniqueId` (routes
 * ledger, slice 10): a partition replaces the Revit FilledRegion and its UniqueId, while the carrier
 * GUID survives, and Work and `rooms.write` key on it. Host-safe: the host's Goal mints it too.
 */
export const regionCode = (guid: string) => subjectCode({ keyKind: "region", key: guid });
/** The carrier GUID a room subject names; any other subject is not a room. */
export const regionOf = (code: string): string | null => {
  const ref = decode(code);
  return ref.ok && ref.value.keyKind === "region" ? ref.value.key : null;
};

/** A room no zone on its view contains: partition never touches it. */
export const unassigned = (region: Pick<RoomsRegion, "role" | "zone">) =>
  region.role === "room" && region.zone == null;

/** A region's label: its name, else `R{n}` by its place in the roster's order. */
export const regionLabel = (region: RoomsRegion, index: number) => region.name || `R${index + 1}`;

/** Levels low to high, as the roster ranks them. */
export const levelOrder = (levels: readonly { name: string; elevation: number }[]) =>
  [...levels].sort((a, b) => a.elevation - b.elevation).map((level) => level.name);

/**
 * Level (in the snapshot's level order), then zones, their rooms zone by zone, unassigned rooms,
 * held; area largest first within each. `R{n}` counts in that order.
 */
export function roomRows(regions: readonly RoomsRegion[], levels: readonly string[]): RoomRow[] {
  const rank = (level: string) => {
    const at = levels.indexOf(level);
    return at < 0 ? levels.length : at;
  };
  const zones = regions
    .filter((region) => region.role === "zone")
    .sort((a, b) => b.sqft - a.sqft)
    .map((zone) => zone.guid);
  const zoneAt = (guid: string | null | undefined) => {
    const at = guid == null ? -1 : zones.indexOf(guid);
    return at < 0 ? zones.length : at;
  };
  const group = (region: RoomsRegion) =>
    region.role === "zone" ? 0 : region.role === "held" ? 3 : unassigned(region) ? 2 : 1;
  return [...regions]
    .sort(
      (a, b) =>
        rank(a.level) - rank(b.level) ||
        a.level.localeCompare(b.level) ||
        group(a) - group(b) ||
        zoneAt(a.zone) - zoneAt(b.zone) ||
        b.sqft - a.sqft,
    )
    .map((region, index) => ({ region, label: regionLabel(region, index) }));
}
