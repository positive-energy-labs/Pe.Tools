import {
  resolveTarget,
  type RouteStateCommandHandlers,
  type StagedRoomEdit,
  type TakeoffsRouteDocument,
} from "@pe/agent-contracts";

import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

export { takeoffsRouteState } from "@pe/agent-contracts";

type Selection = { view: string; zones: string[]; commit?: true };

export function createTakeoffsCommandHandlers(
  options: { hostBaseUrl?: string } = {},
): RouteStateCommandHandlers<TakeoffsRouteDocument> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const caller = (document: TakeoffsRouteDocument) =>
    new HostRpcCaller({ hostBaseUrl, bridgeSessionId: resolveTarget(undefined, document) });

  return {
    adopt: async (raw, ctx) => {
      const input = raw as Selection;
      const document = ctx.getDoc();
      const candidates = document.snapshot?.zoneFrs.filter(
        (zone) =>
          zone.view === input.view &&
          (input.zones.includes(zone.guid ?? "") || input.zones.includes(String(zone.elementId))),
      );
      if (!candidates?.length) throw Error("No selected zoning regions exist in the snapshot.");
      const adopted = await runScript<{ adopted: unknown[] }>(
        caller(document),
        `Result(Pe.Revit.Takeoff.TakeoffJson.Serialize(Pe.Revit.Takeoff.TakeoffAtlas.AdoptZones(doc, ${cs(input.view)}, ${cs(
          JSON.stringify(
            candidates.map((zone) => ({
              elementId: zone.elementId,
              name: zoneMeta(zone.blob).name || zone.typeName,
              systemTag: zoneMeta(zone.blob).systemTag,
            })),
          ),
        )})));`,
        "WriteTransaction",
        "takeoff-adopt.cs",
      );
      return { adopted: adopted.adopted.length };
    },

    audit: async (raw, ctx) => {
      const input = raw as Selection;
      const document = ctx.getDoc();
      const rpc = caller(document);
      const prepared = await runScript<{ level: string }>(
        rpc,
        `Result(Pe.Revit.Takeoff.TakeoffJson.Serialize(Pe.Revit.Takeoff.TakeoffAtlas.PrepareCapture(doc, ${cs(input.view)}, Notify)));`,
        "WriteTransaction",
        "takeoff-prepare.cs",
      );
      const capture = await runScript<{ replayPath: string }>(
        rpc,
        `Result(Pe.Revit.Takeoff.TakeoffJson.Serialize(Pe.Revit.Takeoff.TakeoffAtlas.DetectCapture(doc, ${cs(prepared.level)}, Notify)));`,
        "ReadOnly",
        "takeoff-detect.cs",
      );
      const zones =
        document.snapshot?.world.zones.filter((zone) => input.zones.includes(zone.zone.guid)) ?? [];
      for (const zone of zones) {
        const args = {
          replayPath: capture.replayPath,
          view: zone.zone.lane.view,
          levelFragment: zone.zone.lane.label,
          zoneName: zone.name,
          zoneGuid: zone.zone.guid,
          runId: `run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
          loops: zone.zone.loops,
        };
        await runScript(
          rpc,
          `Result(Pe.Revit.Takeoff.TakeoffJson.Serialize(Pe.Revit.Takeoff.TakeoffAtlas.Partition(doc, ${cs(JSON.stringify(args))}, Notify)));`,
          "WriteTransaction",
          "takeoff-partition.cs",
        );
      }
      return { captured: prepared.level, partitioned: zones.length };
    },

    sync: async (raw, ctx) => {
      const input = raw as Selection;
      const document = ctx.getDoc();
      const path = document.snapshot?.world.r10Path;
      if (!path) throw Error("No .r10 is bound in the takeoff snapshot.");
      const selected = new Set(input.zones);
      const edits = new Map(document.staged.map((edit) => [edit.roomId, edit]));
      const rooms =
        document.snapshot?.world.zones
          .filter((zone) => selected.size === 0 || selected.has(zone.zone.guid))
          .flatMap((zone) => zone.rooms)
          .filter((room) => room.r10 && edits.has(room.guid)) ?? [];
      const rpc = caller(document);
      const opened = await rpc.call("rhvac.open", { path });
      const byId = new Map(opened.rooms.map((room) => [room.identifier, room]));
      const updates = rooms.map((room) => {
        const current = byId.get(room.r10!.identifier);
        if (!current) throw Error(`.r10 room ${room.r10!.identifier} no longer exists.`);
        return applyStaged(current, edits.get(room.guid)!);
      });
      const result = await rpc.call("rhvac.sync", {
        targetPath: path,
        inserts: [],
        updates,
        deleteUntouchedSeedRoom: false,
      });
      const synced = new Set(rooms.map((room) => room.guid));
      document.staged = document.staged.filter((edit) => !synced.has(edit.roomId));
      await ctx.setDoc(document);
      return { updated: result.updated };
    },
  };
}

function applyStaged<A extends Record<string, unknown>>(room: A, edit: StagedRoomEdit): A {
  const next = edit.next;
  return {
    ...room,
    ...(next.name === undefined ? {} : { name: next.name }),
    ...(next.ceilingFt === undefined ? {} : { ceilingHeightFeet: next.ceilingFt }),
    ...(next.people === undefined ? {} : { people: next.people }),
    ...(next.lightingW === undefined ? {} : { lightingWatts: next.lightingW }),
    ...(next.equipSensible === undefined ? {} : { equipmentSensibleBtuh: next.equipSensible }),
    ...(next.equipLatent === undefined ? {} : { equipmentLatentBtuh: next.equipLatent }),
    ...(next.ventilationCfm === undefined ? {} : { ventilationCfm: next.ventilationCfm }),
  };
}

async function runScript<T>(
  caller: HostRpcCaller,
  scriptContent: string,
  permissionMode: "ReadOnly" | "WriteTransaction",
  sourceName: string,
): Promise<T> {
  const response = await caller.call("scripting.execute", {
    scriptContent,
    permissionMode,
    timeoutSeconds: 300,
    sourceName,
  });
  if (response.status !== "Succeeded" || typeof response.data !== "string")
    throw Error(`${sourceName}: ${response.status}`);
  return JSON.parse(response.data) as T;
}

const cs = (value: string) =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;

function zoneMeta(blob: string): { name: string; systemTag: string } {
  try {
    const value = JSON.parse(blob) as { name?: string; systemTag?: string };
    return { name: value.name ?? "", systemTag: value.systemTag ?? "" };
  } catch {
    return { name: "", systemTag: "" };
  }
}
