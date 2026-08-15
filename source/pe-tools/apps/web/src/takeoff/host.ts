/**
 * The /takeoffs route's live wire into Revit.
 *
 * Every call is `scripting.execute` against the connected host — the scripts in scripts.ts stand
 * in for the `takeoffs.*` operations that do not exist yet. Keep this file thin: it owns the
 * transport, the structured script result, and the session scope; nothing about the pipeline's meaning.
 */
import { callHostDynamic } from "#/host/client";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import {
  adoptZonesScript,
  candidateRegionsScript,
  decisionScript,
  detectCaptureScript,
  linkRhvacBatchScript,
  listViewsScript,
  partitionScript,
  prepareCaptureScript,
  registryScript,
  roomTypeScript,
  snapshotScript,
  statusScript,
  zoneRegionsScript,
  zonesScript,
  type AdoptItem,
  type PartitionArgs,
  type RegistryArgs,
  type RhvacLink,
} from "#/takeoff/scripts";
import type {
  CandidateRegion,
  LiveRegion,
  ModelStatus,
  PartitionRun,
  RegistryState,
  Resolution,
  ViewFacts,
} from "#/takeoff/model";

export interface LiveSnapshot {
  status: ModelStatus;
  views: ViewFacts[];
  zoneFrs: CandidateRegion[];
  regionsByZone: Record<string, LiveRegion[]>;
}

interface ScriptResponse {
  status: string;
  output?: string;
  data?: unknown;
  diagnostics?: { severity?: string; message?: string }[];
}

/** `Result(...)` is the contract; terminal output is reserved for short human diagnostics. */
function parseEnvelope<T>(response: ScriptResponse, sourceName: string): T {
  if (response.status !== "Succeeded") {
    const errors = (response.diagnostics ?? [])
      .filter((d) => d.severity === "Error")
      .map((d) => d.message)
      .filter(Boolean);
    throw new Error(`${sourceName}: ${response.status}${errors.length ? ` — ${errors[0]}` : ""}`);
  }
  if (response.data === undefined || response.data === null)
    throw new Error(`${sourceName}: script produced no structured result`);
  if (typeof response.data !== "string")
    throw new Error(`${sourceName}: structured result was not Takeoff JSON`);
  return JSON.parse(response.data) as T;
}

async function runScript<T>(
  scope: HostSessionScope,
  scriptContent: string,
  permissionMode: "ReadOnly" | "WriteTransaction",
  sourceName: string,
): Promise<T> {
  const response = (await callHostDynamic(
    "scripting.execute",
    {
      scriptContent,
      permissionMode,
      timeoutSeconds: 300,
      sourceName,
    },
    scope,
  )) as ScriptResponse;
  return parseEnvelope<T>(response, sourceName);
}

/** One model read and one script compile for the whole atlas. */
export const readSnapshot = (scope: HostSessionScope) =>
  runScript<LiveSnapshot>(scope, snapshotScript(), "ReadOnly", "takeoff-snapshot.cs");

/** Step 0 — what the live document already carries: registry + per-zone region census. */
export const readStatus = (scope: HostSessionScope) =>
  runScript<ModelStatus>(scope, statusScript(), "ReadOnly", "takeoff-status.cs");

/** Step 1 (read) — non-template plan views, for the adoption flow's view pick. */
export const readViews = (scope: HostSessionScope) =>
  runScript<{ views: ViewFacts[] }>(scope, listViewsScript(), "ReadOnly", "takeoff-views.cs").then(
    (r) => r.views,
  );

/** Step 1 (read) — every FilledRegion on one view, stamped or not: the adoption candidates. */
export const readCandidates = (scope: HostSessionScope, view: string) =>
  runScript<{ regions: CandidateRegion[] }>(
    scope,
    candidateRegionsScript({ view }),
    "ReadOnly",
    "takeoff-candidates.cs",
  ).then((r) => r.regions);

/** Step 1 (write) — stamp designer FRs in place as Zoning Regions. Idempotent; re-adopt = edit. */
export const adoptZones = (scope: HostSessionScope, view: string, items: AdoptItem[]) =>
  runScript<{ adopted: { elementId: number; guid: string }[] }>(
    scope,
    adoptZonesScript({ view, items }),
    "WriteTransaction",
    "takeoff-adopt.cs",
  ).then((r) => r.adopted);

/** The zone board's live source: every stamped Zoning Region with its tessellated loops. */
export const readZones = (scope: HostSessionScope) =>
  runScript<{ zones: CandidateRegion[] }>(
    scope,
    zonesScript(),
    "ReadOnly",
    "takeoff-zones.cs",
  ).then((r) => r.zones);

/** Step 2 — validate + register: mints GUIDs for new tags, reports the rename-vs-new questions. */
export const applyRegistry = (scope: HostSessionScope, args: RegistryArgs) =>
  runScript<RegistryState>(scope, registryScript(args), "WriteTransaction", "takeoff-registry.cs");

/** Step 2.5a — capture prepare (WriteTransaction): crop + stripped seed views for the level. */
export const prepareCapture = (scope: HostSessionScope, view: string) =>
  runScript<{ level: string }>(
    scope,
    prepareCaptureScript({ view }),
    "WriteTransaction",
    "takeoff-prepare.cs",
  );

/** Step 2.5b — capture detect (ReadOnly): export ink, detect, dump replay_<level>.bin. */
export const detectCapture = (scope: HostSessionScope, level: string) =>
  runScript<{ level: string; replayPath: string; rooms: number; totalSqft: number }>(
    scope,
    detectCaptureScript({ level }),
    "ReadOnly",
    "takeoff-detect.cs",
  );

/** Step 3 — partition one zone and materialize it into the real zoning view. */
export const partitionZone = (scope: HostSessionScope, args: PartitionArgs) =>
  runScript<PartitionRun>(scope, partitionScript(args), "WriteTransaction", "takeoff-partition.cs");

/** Step 3 (read side) — what is materialized for a zone right now. */
export const readZoneRegions = (
  scope: HostSessionScope,
  args: { view: string; zoneGuid: string },
) =>
  runScript<{ regions: LiveRegion[] }>(
    scope,
    zoneRegionsScript(args),
    "ReadOnly",
    "takeoff-regions.cs",
  ).then((r) => r.regions);

/**
 * The write-through review law: one accept/dismiss, persisted into the Room Region's provenance
 * blob before the UI shows it as decided.
 */
export const writeDecisions = (
  scope: HostSessionScope,
  elementId: number,
  resolutions: Resolution[],
) =>
  runScript<{ elementId: number; zoneGuid: string; bytes: number; blob: string }>(
    scope,
    decisionScript({ elementId, resolutionsJson: JSON.stringify(resolutions) }),
    "WriteTransaction",
    "takeoff-decision.cs",
  );

/** Post-sync: merge the .r10 identity into the typed provenance authority in Revit. */
export const linkRhvacBatch = (
  scope: HostSessionScope,
  writes: { elementId: number; link: RhvacLink }[],
) =>
  runScript<{ elementId: number; zoneGuid: string; bytes: number; blob: string }[]>(
    scope,
    linkRhvacBatchScript(writes),
    "WriteTransaction",
    "takeoff-rhvac-links.cs",
  );

export const writeRoomType = (scope: HostSessionScope, elementId: number, roomType: string) =>
  runScript<string>(
    scope,
    roomTypeScript({ elementId, roomType }),
    "WriteTransaction",
    "takeoff-room-type.cs",
  );
