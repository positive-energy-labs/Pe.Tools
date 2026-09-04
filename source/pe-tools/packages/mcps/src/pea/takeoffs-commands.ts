import {
  bridgeSelector,
  type RouteStateCommandContext,
  type RouteStateCommandHandlers,
  type StagedRoomEdit,
  type TakeoffsRouteDocument,
} from "@pe/agent-contracts";

import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";
import {
  projectTakeoffSnapshot,
  projectTakeoffViews,
  takeoffProjectIndexRequest,
} from "../shared/takeoff-ops.ts";

type Selection = { view: string; zones: string[]; commit?: true };

export function createTakeoffsCommandHandlers(
  options: { hostBaseUrl?: string } = {},
): RouteStateCommandHandlers<TakeoffsRouteDocument> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const runtime = (ctx: RouteStateCommandContext<TakeoffsRouteDocument>) => {
    return new HostRpcCaller({ hostBaseUrl, bridgeSessionId: bridgeSelector(ctx.scope) });
  };

  return {
    adopt: async (raw, ctx) => {
      const input = raw as Selection;
      const caller = runtime(ctx);
      const before = await readSnapshot(caller);
      const candidates = before.zoneFrs.filter(
        (zone) =>
          zone.view === input.view &&
          (input.zones.includes(zone.guid ?? "") || input.zones.includes(String(zone.elementId))),
      );
      if (!candidates.length) throw Error("No selected zoning regions exist in the snapshot.");
      const adopted = await caller.call("takeoffs.adopt", {
        view: input.view,
        items: candidates.map((zone) => ({
          elementId: zone.elementId,
          name: zoneMeta(zone.blob).name || zone.typeName,
          systemTag: zoneMeta(zone.blob).systemTag,
        })),
      });
      const snapshot = await readSnapshot(caller);
      const document = ctx.getDoc();
      document.snapshot = snapshot;
      await ctx.setDoc(document);
      return { adopted: adopted.adopted.length };
    },

    audit: async (raw, ctx) => {
      const input = raw as Selection;
      const caller = runtime(ctx);
      const before = await readSnapshot(caller);
      const prepared = await caller.call("takeoffs.prepare-capture", { view: input.view });
      const capture = await caller.call("takeoffs.detect-capture", { level: prepared.level });
      const zones = before.world.zones.filter((zone) => input.zones.includes(zone.zone.guid));
      for (const zone of zones) {
        await caller.call("takeoffs.partition", {
          replayPath: capture.replayPath,
          view: zone.zone.lane.view,
          levelFragment: zone.zone.lane.label,
          zoneName: zone.name,
          zoneGuid: zone.zone.guid,
          runId: `run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
          loops: zone.zone.loops.map((loop) => loop.map(([x, y]) => [x, y])),
        });
      }
      const snapshot = await readSnapshot(caller);
      const document = ctx.getDoc();
      document.snapshot = snapshot;
      await ctx.setDoc(document);
      return { captured: prepared.level, partitioned: zones.length };
    },

    sync: async (raw, ctx) => {
      const input = raw as Selection;
      const caller = runtime(ctx);
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
      const opened = await caller.call("rhvac.open", { path });
      const byId = new Map(opened.rooms.map((room) => [room.identifier, room]));
      const updates = rooms.map((room) => {
        const current = byId.get(room.r10!.identifier);
        if (!current) throw Error(`.r10 room ${room.r10!.identifier} no longer exists.`);
        return applyStaged(current, edits.get(room.guid)!);
      });
      const result = await caller.call("rhvac.sync", {
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

async function readSnapshot(caller: HostRpcCaller) {
  const [snapshot, documents, projectIndex, viewCounts] = await Promise.all([
    caller.call("takeoffs.snapshot"),
    caller.call("revit.context.document-session"),
    caller.call("revit.catalog.project-index", takeoffProjectIndexRequest),
    caller.call("takeoffs.views"),
  ]);
  const document = documents.activeDocument;
  if (!document) throw Error("The bound Revit session has no active document.");
  return projectTakeoffSnapshot(
    snapshot,
    document.title,
    projectTakeoffViews(viewCounts, projectIndex),
  );
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

function zoneMeta(blob: string): { name: string; systemTag: string } {
  try {
    const value = JSON.parse(blob) as { name?: string; systemTag?: string };
    return { name: value.name ?? "", systemTag: value.systemTag ?? "" };
  } catch {
    return { name: "", systemTag: "" };
  }
}
