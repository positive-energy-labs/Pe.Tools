import type {
  LiveRegion,
  Resolution,
  TakeoffSnapshot,
  ViewFacts,
  World,
  WorldRoom,
  WorldZone,
} from "@pe/agent-contracts";
import type {
  RevitCatalogProjectIndex,
  TakeoffsSnapshot,
  TakeoffsViews,
} from "@pe/host-contracts/generated";

export const takeoffProjectIndexRequest = {
  sections: ["Views"],
  includeUnplacedViews: true,
  projection: { view: "Rows" },
  budget: { maxEntries: 10_000 },
} satisfies RevitCatalogProjectIndex.Req.Request;

const PLAN_VIEW_TYPES = new Set(["FloorPlan", "CeilingPlan", "EngineeringPlan", "AreaPlan"]);

export function projectTakeoffViews(
  response: TakeoffsViews.Res.Response,
  projectIndex: RevitCatalogProjectIndex.Res.Response,
): ViewFacts[] {
  const regionsByView = new Map(response.views.map((view) => [view.elementId, view.regions]));
  return projectIndex.views
    .filter((view) => PLAN_VIEW_TYPES.has(view.viewType) && view.handle.elementId != null)
    .map((view) => ({
      name: view.name,
      level: view.levelName ?? "",
      regions: regionsByView.get(view.handle.elementId!) ?? 0,
    }));
}

export function projectTakeoffSnapshot(
  response: TakeoffsSnapshot.Res.Response,
  documentTitle: string,
  views: readonly Pick<ViewFacts, "name" | "level">[],
): TakeoffSnapshot {
  const snapshot = response.snapshot;
  const zoneFrs = snapshot.zoneFrs.map((region) => ({
    ...region,
    role: region.role ?? null,
    guid: region.guid ?? null,
    loops: region.loops.map(points),
  }));
  const regionsByZone = Object.fromEntries(
    Object.entries(snapshot.regionsByZone).map(([key, regions]) => [
      key,
      regions.map((region) => ({ ...region, outer: points(region.outer) })),
    ]),
  );
  const levelByView = new Map(views.map((view) => [view.name, view.level]));
  const lanes: World["lanes"] = [];
  const ordinals = new Map<string, number>();
  const zones: WorldZone[] = zoneFrs.map((region) => {
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
    const materialized = regionsByZone[region.guid ?? ""] ?? [];
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
    from,
    zoneFrs,
    regionsByZone,
    world: {
      docName: documentTitle,
      r10Path: null,
      lanes,
      zones,
      systems: snapshot.status.systems.map((system) => ({
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
