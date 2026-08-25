import type {
  CandidateRegion,
  LiveRegion,
  ModelStatus,
  PartitionRun,
  RegistryState,
  ReadingFrom,
  Resolution,
  TakeoffRawSnapshot,
  TakeoffSnapshot,
  World,
  WorldRoom,
  WorldZone,
} from "@pe/agent-contracts";

export interface RegistryArgs {
  observed: string[];
  register: string[];
  renames: { guid: string; toTag: string }[];
}

export interface PartitionArgs {
  replayPath: string;
  view: string;
  levelFragment: string;
  zoneName: string;
  zoneGuid: string;
  runId: string;
  loops: readonly (readonly (readonly [number, number])[])[];
}

export interface AdoptItem {
  elementId: number;
  name: string;
  systemTag: string;
}

export interface RhvacLink {
  identifier: number;
  fileIdentity: string;
  syncedAt: string;
  lastSyncedSqft: number;
}

type PermissionMode = "ReadOnly" | "WriteTransaction";
type ScriptResponse = {
  status: string;
  data?: unknown;
  diagnostics?: { severity?: string; message?: string }[];
};
type ScriptExecutor = (input: {
  scriptContent: string;
  permissionMode: PermissionMode;
  timeoutSeconds: number;
  sourceName: string;
}) => Promise<ScriptResponse>;

const cs = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
const json = (value: unknown) => cs(JSON.stringify(value));
const emit = (expression: string) =>
  `Result(Pe.Revit.Takeoff.TakeoffJson.Serialize(${expression}));`;

export const snapshotScript = () => emit("Pe.Revit.Takeoff.TakeoffAtlas.Snapshot(doc)");
export const statusScript = () => emit("Pe.Revit.Takeoff.TakeoffAtlas.Snapshot(doc).Status");
export const listViewsScript = () =>
  emit("new { views = Pe.Revit.Takeoff.TakeoffAtlas.Views(doc) }");
export const candidateRegionsScript = (args: { view: string }) =>
  emit(`new { regions = Pe.Revit.Takeoff.TakeoffAtlas.CandidateRegions(doc, "${cs(args.view)}") }`);
export const zonesScript = () =>
  emit("new { zones = Pe.Revit.Takeoff.TakeoffAtlas.ZoneRegions(doc) }");
export const zoneRegionsScript = (args: { view: string; zoneGuid: string }) =>
  emit(
    `new { regions = Pe.Revit.Takeoff.TakeoffAtlas.RoomRegions(doc, "${cs(args.view)}", new Guid("${cs(args.zoneGuid)}")) }`,
  );
export const adoptZonesScript = (args: { view: string; items: AdoptItem[] }) =>
  emit(`Pe.Revit.Takeoff.TakeoffAtlas.AdoptZones(doc, "${cs(args.view)}", "${json(args.items)}")`);
export const registryScript = (args: RegistryArgs) =>
  emit(`Pe.Revit.Takeoff.TakeoffAtlas.ApplyRegistry(doc, "${json(args)}")`);
export const prepareCaptureScript = (args: { view: string }) =>
  emit(`Pe.Revit.Takeoff.TakeoffAtlas.PrepareCapture(doc, "${cs(args.view)}", Notify)`);
export const detectCaptureScript = (args: { level: string }) =>
  emit(`Pe.Revit.Takeoff.TakeoffAtlas.DetectCapture(doc, "${cs(args.level)}", Notify)`);
export const partitionScript = (args: PartitionArgs) =>
  emit(`Pe.Revit.Takeoff.TakeoffAtlas.Partition(doc, "${json(args)}", Notify)`);
export const decisionScript = (args: { elementId: number; resolutionsJson: string }) =>
  emit(
    `Pe.Revit.Takeoff.TakeoffAtlas.WriteDecisions(doc, ${Math.trunc(args.elementId)}L, "${cs(args.resolutionsJson)}")`,
  );
export const linkRhvacBatchScript = (writes: { elementId: number; link: RhvacLink }[]) =>
  emit(`Pe.Revit.Takeoff.TakeoffAtlas.LinkRhvacBatch(doc, "${json(writes)}")`);
export const roomTypeScript = (args: { elementId: number; roomType: string }) =>
  emit(
    `Pe.Revit.Takeoff.TakeoffAtlas.WriteRoomType(doc, ${Math.trunc(args.elementId)}L, "${cs(args.roomType)}")`,
  );

function parse<T>(response: ScriptResponse, sourceName: string): T {
  if (response.status !== "Succeeded") {
    const error = response.diagnostics?.find((item) => item.severity === "Error")?.message;
    throw Error(`${sourceName}: ${response.status}${error ? ` — ${error}` : ""}`);
  }
  if (typeof response.data !== "string") throw Error(`${sourceName}: no Takeoff JSON`);
  return JSON.parse(response.data) as T;
}

export function createTakeoffOperations(execute: ScriptExecutor) {
  const run = async <T>(
    scriptContent: string,
    permissionMode: PermissionMode,
    sourceName: string,
  ) =>
    parse<T>(
      await execute({ scriptContent, permissionMode, timeoutSeconds: 300, sourceName }),
      sourceName,
    );
  return {
    snapshot: () =>
      run<TakeoffRawSnapshot>(snapshotScript(), "ReadOnly", "takeoff-snapshot.cs").then((raw) => {
        const levelByView = new Map(raw.views.map((view) => [view.name, view.level]));
        const lanes: World["lanes"] = [];
        const ordinals = new Map<string, number>();
        const zones: WorldZone[] = raw.zoneFrs.map((region) => {
          const meta = JSON.parse(region.blob) as {
            view?: string;
            name?: string;
            systemTag?: string;
          };
          if (!meta.view || !meta.name)
            throw Error("Zoning Region provenance is missing view or name");
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
        return {
          ...raw,
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
      }),
    status: () => run<ModelStatus>(statusScript(), "ReadOnly", "takeoff-status.cs"),
    views: () =>
      run<{ views: TakeoffRawSnapshot["views"] }>(
        listViewsScript(),
        "ReadOnly",
        "takeoff-views.cs",
      ).then((result) => result.views),
    candidates: (view: string) =>
      run<{ regions: CandidateRegion[] }>(
        candidateRegionsScript({ view }),
        "ReadOnly",
        "takeoff-candidates.cs",
      ).then((result) => result.regions),
    adopt: (view: string, items: AdoptItem[]) =>
      run<{ adopted: { elementId: number; guid: string }[] }>(
        adoptZonesScript({ view, items }),
        "WriteTransaction",
        "takeoff-adopt.cs",
      ).then((result) => result.adopted),
    zones: () =>
      run<{ zones: CandidateRegion[] }>(zonesScript(), "ReadOnly", "takeoff-zones.cs").then(
        (result) => result.zones,
      ),
    registry: (args: RegistryArgs) =>
      run<RegistryState>(registryScript(args), "WriteTransaction", "takeoff-registry.cs"),
    prepare: (view: string) =>
      run<{ level: string }>(
        prepareCaptureScript({ view }),
        "WriteTransaction",
        "takeoff-prepare.cs",
      ),
    detect: (level: string) =>
      run<{ level: string; replayPath: string; rooms: number; totalSqft: number }>(
        detectCaptureScript({ level }),
        "ReadOnly",
        "takeoff-detect.cs",
      ),
    partition: (args: PartitionArgs) =>
      run<PartitionRun>(partitionScript(args), "WriteTransaction", "takeoff-partition.cs"),
    regions: (args: { view: string; zoneGuid: string }) =>
      run<{ regions: LiveRegion[] }>(
        zoneRegionsScript(args),
        "ReadOnly",
        "takeoff-regions.cs",
      ).then((result) => result.regions),
    decisions: (elementId: number, resolutions: Resolution[]) =>
      run<{ elementId: number; zoneGuid: string; bytes: number; blob: string }>(
        decisionScript({ elementId, resolutionsJson: JSON.stringify(resolutions) }),
        "WriteTransaction",
        "takeoff-decision.cs",
      ),
    linkRhvac: (writes: { elementId: number; link: RhvacLink }[]) =>
      run<{ elementId: number; zoneGuid: string; bytes: number; blob: string }[]>(
        linkRhvacBatchScript(writes),
        "WriteTransaction",
        "takeoff-rhvac-links.cs",
      ),
    roomType: (elementId: number, roomType: string) =>
      run<string>(
        roomTypeScript({ elementId, roomType }),
        "WriteTransaction",
        "takeoff-room-type.cs",
      ),
  };
}

export async function produceTakeoffSnapshot(
  read: () => Promise<Omit<TakeoffSnapshot, "from">>,
  source: Pick<ReadingFrom, "target" | "documentId">,
  write: (snapshot: TakeoffSnapshot) => Promise<unknown>,
): Promise<TakeoffSnapshot> {
  const snapshot = { ...(await read()), from: { ...source, observedAt: new Date().toISOString() } };
  await write(snapshot);
  return snapshot;
}

const centroid = (loop: readonly (readonly [number, number])[]): [number, number] => {
  const sum = loop.reduce(([x, y], [px, py]) => [x + px, y + py], [0, 0]);
  return [sum[0] / Math.max(loop.length, 1), sum[1] / Math.max(loop.length, 1)];
};
const bounds = (loops: readonly (readonly (readonly [number, number])[])[]) => {
  const points = loops.flat();
  return {
    minX: Math.min(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxX: Math.max(...points.map(([x]) => x)),
    maxY: Math.max(...points.map(([, y]) => y)),
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
    provenance: {
      runId,
      sourceRoomId,
      sourceSqft,
    },
    r10: value.r10 ?? null,
    data: null,
    outer: region.outer,
    holes: [],
  };
}
