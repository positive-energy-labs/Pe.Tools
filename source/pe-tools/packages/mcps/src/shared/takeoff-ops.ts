import {
  readingSchema,
  takeoffCarrierPreflightSchema,
  takeoffRegionAnalysisSchema,
} from "@pe/agent-contracts";
import type {
  LiveRegion,
  Resolution,
  PartitionReviewData,
  TakeoffSnapshot,
  ViewFacts,
  World,
  WorldRoom,
  WorldZone,
} from "@pe/agent-contracts";
import type { RevitCatalogProjectIndex, TakeoffsSnapshot } from "@pe/host-contracts/generated";

export const takeoffProjectIndexRequest = {
  sections: ["Views"],
  includeUnplacedViews: true,
  projection: { view: "Rows" },
  budget: { maxEntries: 10_000 },
} satisfies RevitCatalogProjectIndex.Req.Request;

const PLAN_VIEW_TYPES = new Set(["FloorPlan", "CeilingPlan", "EngineeringPlan", "AreaPlan"]);

// ADR 0011 deleted takeoffs.views with the raster. The view list comes from the project index; the
// per-view FilledRegion count went with the op rather than being faked at zero.
export function projectTakeoffViews(
  projectIndex: RevitCatalogProjectIndex.Res.Response,
): ViewFacts[] {
  return projectIndex.views.flatMap((view) => {
    if (!PLAN_VIEW_TYPES.has(view.viewType) || view.handle.elementId == null) return [];
    return [{ name: view.name, level: view.levelName ?? "" }];
  });
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
      regions.map((region) => ({
        ...region,
        analysis: region.analysis ? takeoffRegionAnalysisSchema.parse(region.analysis) : null,
        outer: points(region.outer),
        holes: region.holes.map(points),
      })),
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
    if (!meta.view) throw Error("Zoning Region provenance is missing view");
    const view = region.view || meta.view;
    const name = meta.name?.trim() || `${view} · ${region.elementId}`;
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
      .map((item) => {
        const value = JSON.parse(item.blob) as {
          partition?: { disposition?: number | string };
        };
        return {
          id: item.guid,
          reason: disposition(value.partition?.disposition) === "void" ? "void" : "held",
          rawSqft: item.sqft,
          label: centroid(item.outer),
          outer: item.outer,
          holes: item.holes,
        };
      });
    const tags = meta.systemTag ? [meta.systemTag] : [];
    const stage =
      materialized.length === 0
        ? tags.length > 0
          ? "registered"
          : "declared"
        : residues.length > 0 || rooms.some((item) => item.flags.length > 0)
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
        declaredSqft: region.sqft,
        bounds: bounds(region.loops),
      },
      stage,
      tags,
      name,
      rooms,
      residues,
      heldSqft: residues.reduce((sum, item) => sum + item.rawSqft, 0),
      runs: [],
      driftSqft: null, // Coverage drift has not been measured by this projection.
      savedReview: savedReview(
        response.reading.at,
        region.guid ?? "",
        name,
        region.loops,
        materialized,
      ),
    };
  });
  return {
    reading: readingSchema.parse(response.reading),
    carriers: takeoffCarrierPreflightSchema.parse(snapshot.status.carriers),
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

const DISPOSITIONS = ["accepted", "held", "void", "excluded"] as const;

function savedReview(
  documentKey: string,
  scopeKey: string,
  name: string,
  zoneLoops: [number, number][][],
  regions: LiveRegion[],
): PartitionReviewData | null {
  if (regions.length === 0) return null;
  const values = regions.map((region) => ({
    region,
    value: JSON.parse(region.blob) as {
      RunId?: string;
      runId?: string;
      SourceRoomId?: string;
      sourceRoomId?: string;
      partition?: { disposition?: number | string; reason?: string | null };
    },
  }));
  if (
    values.some(
      ({ value }) => !(value.RunId ?? value.runId) || !(value.SourceRoomId ?? value.sourceRoomId),
    )
  )
    throw Error("Native takeoff review provenance is missing runId or sourceRoomId");
  const runIds = [...new Set(values.map(({ value }) => (value.RunId ?? value.runId)!))];

  return {
    source: {
      runId: runIds.length === 1 ? runIds[0]! : null,
      documentKey,
      scopeKey,
    },
    zone: { key: scopeKey, name, loops: zoneLoops },
    shapes: values.map(({ region, value }) => ({
      original: {
        runId: (value.RunId ?? value.runId)!,
        sourceRoomId: (value.SourceRoomId ?? value.sourceRoomId)!,
        disposition: disposition(value.partition?.disposition),
        reason: value.partition?.reason ?? null,
      },
      id: region.guid,
      kind: region.role === "held-residue" ? ("residue" as const) : ("room" as const),
      disposition: null,
      reason: [
        `measurements ${region.analysis?.state ?? "unmeasured"}`,
        region.analysis?.hold,
        `original ${disposition(value.partition?.disposition) ?? "unknown"}: ${value.partition?.reason ?? "no reason"} (${value.RunId ?? value.runId}/${value.SourceRoomId ?? value.sourceRoomId})`,
      ]
        .filter(Boolean)
        .join(" | "),
      sqft: region.sqft,
      label: centroid(region.outer),
      loops: [region.outer, ...region.holes],
    })),
  };
}

const disposition = (
  value: number | string | undefined,
): PartitionReviewData["shapes"][number]["disposition"] =>
  typeof value === "number"
    ? (DISPOSITIONS[value] ?? null)
    : (DISPOSITIONS.find((item) => item === value?.toLowerCase()) ?? null);

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
    partition?: { floorZ?: number | null; ceilingZ?: number | null };
  };
  const runId = value.RunId ?? value.runId;
  const sourceRoomId = value.SourceRoomId ?? value.sourceRoomId;
  const sourceSqft = value.SourceSqft ?? value.sourceSqft;
  if (!runId || !sourceRoomId || typeof sourceSqft !== "number")
    throw Error("Room Region provenance is missing runId, sourceRoomId, or sourceSqft");
  const analysis = region.analysis;
  const current = analysis?.state === "current";
  const decisions = (value.resolutions ?? []).filter(
    (decision) => current && decision.runId === analysis.runId,
  );
  const measurementFlags = !current
    ? [analysis?.state === "stale" ? "geometry-changed" : "remeasure-required"]
    : analysis.hold
      ? [analysis.hold]
      : [];
  return {
    analysis,
    guid: region.guid,
    elementId: region.elementId,
    name: sourceRoomId,
    type: (region.roomType || "hall") as WorldRoom["type"],
    sqft: Math.round(region.sqft),
    ceilingFt:
      current && analysis.floorZ != null && analysis.ceilingZ != null
        ? analysis.ceilingZ - analysis.floorZ
        : 0,
    label: centroid(region.outer),
    flags: [
      ...measurementFlags,
      ...(value.flags ?? []).filter(
        (flag) => !decisions.some((item) => item.subject === sourceRoomId && item.flag === flag),
      ),
      ...(value.r10 ? ["r10-not-open"] : []),
    ],
    decisions,
    provenance: { runId: analysis?.runId ?? runId, sourceRoomId, sourceSqft },
    r10: value.r10 ?? null,
    data: null,
    outer: region.outer,
    holes: region.holes,
  };
}
