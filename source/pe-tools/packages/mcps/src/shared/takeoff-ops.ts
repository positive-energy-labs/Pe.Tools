import type {
  LiveRegion,
  Resolution,
  TakeoffRawSnapshot,
  TakeoffSnapshot,
  World,
  WorldRoom,
  WorldZone,
} from "@pe/agent-contracts";
import type { TakeoffsSnapshot } from "@pe/host-contracts/generated";

export function projectTakeoffSnapshot(response: TakeoffsSnapshot.Res.Response): TakeoffSnapshot {
  const snapshot = response.snapshot;
  const raw: TakeoffRawSnapshot = {
    status: snapshot.status,
    views: snapshot.views,
    zoneFrs: snapshot.zoneFrs.map((region) => ({
      ...region,
      role: region.role ?? null,
      guid: region.guid ?? null,
      loops: region.loops.map(points),
    })),
    regionsByZone: Object.fromEntries(
      Object.entries(snapshot.regionsByZone).map(([key, regions]) => [
        key,
        regions.map((region) => ({ ...region, outer: points(region.outer) })),
      ]),
    ),
  };
  const levelByView = new Map(raw.views.map((view) => [view.name, view.level]));
  const lanes: World["lanes"] = [];
  const ordinals = new Map<string, number>();
  const zones: WorldZone[] = raw.zoneFrs.map((region) => {
    const meta = JSON.parse(region.blob) as {
      view?: string;
      name?: string;
      systemTag?: string;
    };
    if (!meta.view || !meta.name) throw Error("Zoning Region provenance is missing view or name");
    const view = region.view || meta.view;
    const label = levelByView.get(view) || view;
    let lane = lanes.find((item) => item.view === view);
    if (!lane) {
      lane = { view, label, replayPath: null };
      lanes.push(lane);
    }
    const ordinal = (ordinals.get(view) ?? 0) + 1;
    ordinals.set(view, ordinal);
    const materialized = raw.regionsByZone[region.guid ?? ""] ?? [];
    const rooms = materialized.filter((item) => item.role !== "held-residue").map(room);
    const residues = materialized
      .filter((item) => item.role === "held-residue")
      .map((item) => ({
        id: item.guid,
        reason: "held",
        rawSqft: item.sqft,
        label: centroid(item.outer),
        outer: item.outer,
        holes: [],
      }));
    const tags = meta.systemTag ? [meta.systemTag] : [];
    const stage =
      rooms.length === 0
        ? tags.length > 0
          ? "registered"
          : "declared"
        : rooms.some((item) => item.flags.length > 0)
          ? "partitioned"
          : "reviewed";
    return {
      zone: {
        guid: region.guid ?? "",
        elementId: region.elementId,
        key: `${label}#${String(ordinal).padStart(2, "0")}`,
        ordinal,
        lane,
        color: region.color,
        loops: region.loops,
        declaredSqft: region.loops.reduce(
          (sum, loop) =>
            sum +
            Math.abs(
              loop.reduce((area, point, index) => {
                const next = loop[(index + 1) % loop.length]!;
                return area + point[0] * next[1] - next[0] * point[1];
              }, 0),
            ) /
              2,
          0,
        ),
        bounds: bounds(region.loops),
      },
      stage,
      tags,
      name: meta.name,
      rooms,
      residues,
      heldSqft: residues.reduce((sum, item) => sum + item.rawSqft, 0),
      runs: [],
      driftSqft: 0,
    };
  });
  const from = {
    target: response.from.target,
    documentId: response.from.documentId,
    ...(response.from.documentVersionToken == null
      ? {}
      : { documentVersionToken: response.from.documentVersionToken }),
    observedAt: response.from.observedAt,
  };
  return {
    ...raw,
    from,
    world: {
      docName: raw.status.doc,
      r10Path: null,
      lanes,
      zones,
      systems: raw.status.systems.map((system) => ({
        ...system,
        zoneKeys: zones
          .filter((zone) => zone.tags.includes(system.tag))
          .map((zone) => zone.zone.key),
        sensibleBtuh: 0,
        overCap: false,
      })),
    },
  };
}

export async function produceTakeoffSnapshot(
  read: () => Promise<TakeoffSnapshot>,
  write: (snapshot: TakeoffSnapshot) => Promise<unknown>,
): Promise<TakeoffSnapshot> {
  const snapshot = await read();
  await write(snapshot);
  return snapshot;
}

const points = (values: number[][]): [number, number][] =>
  values.map(([x, y]) => {
    if (x === undefined || y === undefined) throw Error("Takeoff boundary point requires x and y");
    return [x, y];
  });

const centroid = (loop: readonly (readonly [number, number])[]): [number, number] => {
  const sum = loop.reduce(([x, y], [px, py]) => [x + px, y + py], [0, 0]);
  return [sum[0] / Math.max(loop.length, 1), sum[1] / Math.max(loop.length, 1)];
};
const bounds = (loops: readonly (readonly (readonly [number, number])[])[]) => {
  const all = loops.flat();
  return {
    minX: Math.min(...all.map(([x]) => x)),
    minY: Math.min(...all.map(([, y]) => y)),
    maxX: Math.max(...all.map(([x]) => x)),
    maxY: Math.max(...all.map(([, y]) => y)),
  };
};

function room(region: LiveRegion): WorldRoom {
  const value = JSON.parse(region.blob) as {
    RunId?: string;
    runId?: string;
    SourceRoomId?: string;
    sourceRoomId?: string;
    SourceSqft?: number;
    sourceSqft?: number;
    resolutions?: Resolution[];
    flags?: string[];
    r10?: WorldRoom["r10"];
  };
  const runId = value.RunId ?? value.runId;
  const sourceRoomId = value.SourceRoomId ?? value.sourceRoomId;
  const sourceSqft = value.SourceSqft ?? value.sourceSqft;
  if (!runId || !sourceRoomId || typeof sourceSqft !== "number")
    throw Error("Room Region provenance is missing runId, sourceRoomId, or sourceSqft");
  const decisions = value.resolutions ?? [];
  return {
    guid: region.guid,
    elementId: region.elementId,
    name: sourceRoomId,
    type: (region.roomType || "hall") as WorldRoom["type"],
    sqft: Math.round(region.sqft),
    ceilingFt: 0,
    label: centroid(region.outer),
    flags: [
      ...(value.flags ?? []).filter(
        (flag) => !decisions.some((item) => item.subject === sourceRoomId && item.flag === flag),
      ),
      ...(value.r10 ? ["r10-not-open"] : []),
    ],
    decisions,
    provenance: { runId, sourceRoomId, sourceSqft },
    r10: value.r10 ?? null,
    data: null,
    outer: region.outer,
    holes: [],
  };
}
