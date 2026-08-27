import { callHostRpc } from "#/host/client";
import { fromBridgeSessions } from "#/host/target";
import type { RhvacInsertRoomData } from "@pe/host-contracts/operation-types";
import {
  projectTakeoffSnapshot,
  projectTakeoffViews,
  takeoffProjectIndexRequest,
} from "../../../../packages/mcps/src/shared/takeoff-ops.ts";
import type { SessionEvent, SessionSource, TakeoffHost } from "#/takeoff/store";
import type { WorldRoom, WorldZone } from "#/takeoff/world";

const WALL_ASSEMBLY =
  "R-3 insulated sheathing, R-13 closed cell sprayfoam in a 2x6 wood stud cavity, R-15 Fiberglass batt";
const ROOF_ASSEMBLY = "R49 closed cell sprayfoam in 2x14 joist cavity";
const FLOOR_ASSEMBLY =
  "R-19 open cell 1/2 lb. spray foam insulation, 5 inches in 2 x 10 joist cavity, any cover";

function buildRhvacInsert(
  room: WorldRoom,
  number: number,
  systemNumber: number,
): RhvacInsertRoomData {
  const height = room.ceilingFt || 8;
  const outer = room.outer ?? [];
  const walls = outer.map(([x1, y1], index) => {
    const [x2, y2] = outer[(index + 1) % outer.length]!;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const octant = ((Math.round((angle + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
    return {
      index1: index + 1,
      assembly: WALL_ASSEMBLY,
      uValue: 0.036,
      lengthFeet: Math.hypot(x2 - x1, y2 - y1),
      heightFeet: height,
      direction: octant + 1,
    };
  });
  return {
    number,
    name: room.name,
    systemNumber,
    zoneNumber: 1,
    areaSquareFeet: room.sqft,
    ceilingHeightFeet: height,
    people: room.data!.people,
    lightingWatts: room.data!.lightingW,
    equipmentSensibleBtuh: room.data!.equipSensible,
    equipmentLatentBtuh: room.data!.equipLatent,
    ventilationCfm: room.data!.ventilationCfm,
    floors: [
      {
        assembly: FLOOR_ASSEMBLY,
        uValue: 0.051,
        areaSquareFeet: room.sqft,
        exposedPerimeterFeet: walls.reduce((sum, wall) => sum + wall.lengthFeet, 0),
      },
    ],
    roofs: [
      { assembly: ROOF_ASSEMBLY, uValue: 0.024, areaSquareFeet: room.sqft, areaMultiplier: 1.2 },
    ],
    walls,
    glass: [],
    doors: [],
  };
}

async function syncRhvacRooms(
  sessionId: string,
  path: string,
  inserts: readonly { readonly zone: WorldZone; readonly room: WorldRoom }[],
) {
  const scope = { bridgeSessionId: sessionId };
  const before = await callHostRpc("rhvac.open", { path }, scope);
  const firstRoomNumber = Math.max(0, ...before.rooms.map((room) => room.number)) + 1;
  const bySystemName = new Map(
    before.systems
      .filter((system) => system.name.trim().length > 0)
      .map((system) => [system.name.trim().toLocaleLowerCase(), system.number]),
  );
  const firstRun =
    before.rooms.length === 1 &&
    before.rooms[0]!.number === 1 &&
    before.rooms[0]!.name.trim().length === 0 &&
    before.rooms[0]!.areaSquareFeet === 0;
  let nextSystemNumber = Math.max(0, ...before.systems.map((system) => system.number)) + 1;
  const tags = [...new Set(inserts.map(({ zone }) => zone.tags[0]!))];
  const systemNumbers = new Map<string, number>();
  for (const tag of tags) {
    const existing = bySystemName.get(tag.trim().toLocaleLowerCase());
    if (existing !== undefined) systemNumbers.set(tag, existing);
    else if (firstRun) systemNumbers.set(tag, nextSystemNumber++);
    else throw Error(`system '${tag}' does not exist in this non-first-run .r10`);
  }
  const result = await callHostRpc(
    "rhvac.sync",
    {
      targetPath: path,
      updates: [],
      inserts: inserts.map(({ zone, room }, index) =>
        buildRhvacInsert(room, firstRoomNumber + index, systemNumbers.get(zone.tags[0]!)!),
      ),
      systems: tags.map((tag) => ({ number: systemNumbers.get(tag)!, name: tag })),
      deleteUntouchedSeedRoom: true,
    },
    scope,
  );
  const fileIdentity = `${result.fileIdentity.fileName}#${result.fileIdentity.stamp}`;
  const byNumber = new Map(result.insertedRooms.map((room) => [room.number, room.identifier]));
  const now = new Date().toISOString();
  const links = inserts.map(({ room }, index) => {
    const number = firstRoomNumber + index;
    const identifier = byNumber.get(number);
    if (identifier === undefined) throw Error(`.r10 sync omitted room ${number}`);
    return {
      elementId: room.elementId!,
      link: { identifier, fileIdentity, syncedAt: now, lastSyncedSqft: room.sqft },
    };
  });
  if (byNumber.size !== links.length)
    throw Error(`.r10 sync returned ${byNumber.size} receipts for ${links.length} rooms`);
  await callHostRpc("takeoffs.rhvac-links", { writes: links }, scope);
  return {
    text:
      `synced ${result.insertedRooms.length}/${inserts.length} rooms into ${path}` +
      ` (${result.roomsBefore}→${result.roomsAfter} rooms, seed room ${result.seedRoom.action})` +
      (result.backupPath ? ` · backup: ${result.backupPath}` : ""),
  };
}

export const createHostSessionSource = (): SessionSource => ({
  async list() {
    const response = await callHostRpc("bridge.sessions.list", undefined);
    const yearBySession = new Map(
      response.sessions.map((session) => [session.sessionId, session.revitVersion ?? undefined]),
    );
    return fromBridgeSessions(response.sessions).map((session) => ({
      ...session,
      year: yearBySession.get(session.sessionId),
    }));
  },
  async activeDocument(session) {
    const response = await callHostRpc("revit.context.document-session", undefined, {
      bridgeSessionId: session.sessionId,
    });
    const document = response.activeDocument;
    if (!document) throw new Error(`session ${session.sessionId} has no active document`);
    const documentId = document.cloudModelGuid ?? document.path;
    if (!documentId)
      throw new Error(
        `session ${session.sessionId} active document has no cloud model GUID or absolute path`,
      );
    return { session, documentId, title: document.title };
  },
  subscribe(listener) {
    const source = new EventSource("/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as {
          readonly sessionId?: string;
          readonly kind?: "connected" | "disconnected" | "state-sync" | "event";
        };
        if (!event.sessionId) return;
        const kind: SessionEvent["kind"] =
          event.kind === "connected" || event.kind === "disconnected"
            ? "sessionsChanged"
            : "docChanged";
        listener({ kind, sessionId: event.sessionId });
      } catch {
        // The next well-formed host event remains usable; malformed SSE cannot name a safe key.
      }
    };
    return () => source.close();
  },
});

export const createLiveTakeoffHost = (): TakeoffHost => ({
  fixture: false,
  async readSnapshot(session, document, views, write) {
    const scope = { bridgeSessionId: session.sessionId };
    const response = await callHostRpc("takeoffs.snapshot", undefined, scope);
    const snapshot = projectTakeoffSnapshot(response, document.title, views);
    await write(snapshot);
    return snapshot;
  },
  async readViews(session) {
    const scope = { bridgeSessionId: session.sessionId };
    const [views, projectIndex] = await Promise.all([
      callHostRpc("takeoffs.views", undefined, scope),
      callHostRpc("revit.catalog.project-index", takeoffProjectIndexRequest, scope),
    ]);
    return projectTakeoffViews(views, projectIndex);
  },
  async listRhvac(dir) {
    const response = await callHostRpc("rhvac.list", { dir });
    return response.exists ? [...(response.files ?? [])] : [];
  },
  openRhvac: (path) => callHostRpc("rhvac.open", { path }),
  readCandidates: async (session, view) => {
    const response = await callHostRpc(
      "takeoffs.candidates",
      { view },
      { bridgeSessionId: session.sessionId },
    );
    return response.regions.map((region) => ({
      ...region,
      role: region.role ?? null,
      guid: region.guid ?? null,
      loops: region.loops.map(toPoints),
    }));
  },
  async adopt(session, input) {
    const adopted = await callHostRpc(
      "takeoffs.adopt",
      { view: input.view, items: [...input.items] },
      { bridgeSessionId: session.sessionId },
    );
    return { text: `adopted ${adopted.adopted.length} zoning regions` };
  },
  async capture(session, lane) {
    const scope = { bridgeSessionId: session.sessionId };
    const prepared = await callHostRpc("takeoffs.prepare-capture", { view: lane.view }, scope);
    return callHostRpc("takeoffs.detect-capture", { level: prepared.level }, scope);
  },
  async partition(session, input) {
    const response = await callHostRpc(
      "takeoffs.partition",
      {
        ...input,
        loops: input.loops.map((loop) => loop.map(([x, y]) => [x, y])),
      },
      { bridgeSessionId: session.sessionId },
    );
    return {
      ...response,
      rooms: response.rooms.map((room) => ({
        ...room,
        label: toPoint(room.label),
        outer: toPoints(room.outer),
      })),
      residues: response.residues.map((residue) => ({
        ...residue,
        label: toPoint(residue.label),
        outer: toPoints(residue.outer),
      })),
      regions: response.regions.map((region) => ({
        ...region,
        outer: toPoints(region.outer),
      })),
    };
  },
  async writeDecisions(session, elementId, resolutions) {
    const result = await callHostRpc(
      "takeoffs.decisions",
      { elementId, resolutions: [...resolutions] },
      { bridgeSessionId: session.sessionId },
    );
    return { blob: result.blob };
  },
  writeRoomType: async (session, elementId, roomType) => {
    await callHostRpc(
      "takeoffs.room-type",
      { elementId, roomType },
      { bridgeSessionId: session.sessionId },
    );
  },
  async launchRhvac(session, path) {
    await callHostRpc(
      "rhvac.launch",
      { path },
      session ? { bridgeSessionId: session.sessionId } : undefined,
    );
  },
  syncRhvac: (session, path, inserts) => syncRhvacRooms(session.sessionId, path, inserts),
});

const toPoint = ([x, y]: number[]): [number, number] => {
  if (x === undefined || y === undefined) throw Error("Takeoff boundary point requires x and y");
  return [x, y];
};

const toPoints = (values: number[][]): [number, number][] => values.map(toPoint);
