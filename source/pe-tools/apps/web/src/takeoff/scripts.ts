/**
 * Tiny C# invocations for the dev lane. Product behavior and JSON shaping live in
 * Pe.Revit.Takeoff.TakeoffAtlas; these strings only cross the scripting transport.
 */

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
