import type { RoomType, Stage, WorldRoom } from "@pe/agent-contracts";

export type {
  RoomData,
  RoomType,
  Stage,
  World,
  WorldLane,
  WorldRoom,
  WorldSystem,
  WorldZone,
} from "@pe/agent-contracts";

export const STAGE_ORDER: Stage[] = [
  "declared",
  "registered",
  "partitioned",
  "reviewed",
  "data",
  "synced",
  "drifted",
];

export const SENSIBLE_CAP_BTUH = 32_000;

export interface RoomEdit {
  name?: string;
  type?: RoomType;
  ceilingFt?: number;
  people?: number;
  lightingW?: number;
  equipSensible?: number;
  equipLatent?: number;
  ventilationCfm?: number;
}

export function readZoneMeta(blob: string): { view: string; name: string; systemTag: string } {
  const parsed = JSON.parse(blob) as { view?: string; name?: string; systemTag?: string };
  if (!parsed.view || !parsed.name)
    throw new Error("Zoning Region provenance is missing view or name");
  return { view: parsed.view, name: parsed.name, systemTag: parsed.systemTag ?? "" };
}

export const applyEdit = (room: WorldRoom, edit: RoomEdit | undefined): WorldRoom => {
  if (!edit) return room;
  const hasData =
    edit.people !== undefined ||
    edit.lightingW !== undefined ||
    edit.equipSensible !== undefined ||
    edit.equipLatent !== undefined ||
    edit.ventilationCfm !== undefined;
  const base = room.data ?? {
    people: 0,
    lightingW: 0,
    equipSensible: 0,
    equipLatent: 0,
    ventilationCfm: 0,
  };
  return {
    ...room,
    name: edit.name ?? room.name,
    type: edit.type ?? room.type,
    ceilingFt: edit.ceilingFt ?? room.ceilingFt,
    data: hasData
      ? {
          people: edit.people ?? base.people,
          lightingW: edit.lightingW ?? base.lightingW,
          equipSensible: edit.equipSensible ?? base.equipSensible,
          equipLatent: edit.equipLatent ?? base.equipLatent,
          ventilationCfm: edit.ventilationCfm ?? base.ventilationCfm,
        }
      : room.data,
  };
};
