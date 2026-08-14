/**
 * The /takeoff route's live wire into Revit.
 *
 * Every call is `scripting.execute` against the connected host — the scripts in scripts.ts stand
 * in for the `takeoff.*` operations that do not exist yet. Keep this file thin: it owns the
 * transport and the PE_JSON envelope, nothing about the pipeline's meaning.
 */
import { callHostDynamic } from "#/host/client";
import {
  decisionScript,
  partitionScript,
  registryScript,
  statusScript,
  zoneRegionsScript,
  type PartitionArgs,
  type RegistryArgs,
} from "#/takeoff/scripts";
import type { LiveRegion, ModelStatus, PartitionRun, RegistryState, Resolution } from "#/takeoff/model";

interface ScriptResponse {
  status: string;
  output?: string;
  diagnostics?: { severity?: string; message?: string }[];
}

/** One `PE_JSON <json>` line is the contract; anything else is a failed call, never a guess. */
function parseEnvelope<T>(response: ScriptResponse, sourceName: string): T {
  if (response.status !== "Succeeded") {
    const errors = (response.diagnostics ?? [])
      .filter((d) => d.severity === "Error")
      .map((d) => d.message)
      .filter(Boolean);
    throw new Error(`${sourceName}: ${response.status}${errors.length ? ` — ${errors[0]}` : ""}`);
  }
  const line = (response.output ?? "").split(/\r?\n/).find((l) => l.startsWith("PE_JSON "));
  if (!line) throw new Error(`${sourceName}: script produced no PE_JSON line`);
  return JSON.parse(line.slice("PE_JSON ".length)) as T;
}

async function runScript<T>(
  scriptContent: string,
  permissionMode: "ReadOnly" | "WriteTransaction",
  sourceName: string,
): Promise<T> {
  const response = (await callHostDynamic("scripting.execute", {
    scriptContent,
    permissionMode,
    timeoutSeconds: 300,
    sourceName,
  })) as ScriptResponse;
  return parseEnvelope<T>(response, sourceName);
}

/** Step 0 — what the live document already carries: registry + per-zone region census. */
export const readStatus = () =>
  runScript<ModelStatus>(statusScript(), "ReadOnly", "takeoff-status.cs");

/** Step 2 — validate + register: mints GUIDs for new tags, reports the rename-vs-new questions. */
export const applyRegistry = (args: RegistryArgs) =>
  runScript<RegistryState>(registryScript(args), "WriteTransaction", "takeoff-registry.cs");

/** Step 3 — partition one zone and materialize it into the real zoning view. */
export const partitionZone = (args: PartitionArgs) =>
  runScript<PartitionRun>(partitionScript(args), "WriteTransaction", "takeoff-partition.cs");

/** Step 3 (read side) — what is materialized for a zone right now. */
export const readZoneRegions = (args: { view: string; zoneGuid: string }) =>
  runScript<{ regions: LiveRegion[] }>(
    zoneRegionsScript(args),
    "ReadOnly",
    "takeoff-regions.cs",
  ).then((r) => r.regions);

/**
 * The write-through review law: one accept/dismiss, persisted into the Room Region's provenance
 * blob before the UI shows it as decided.
 */
export const writeDecisions = (elementId: number, resolutions: Resolution[]) =>
  runScript<{ elementId: number; zoneGuid: string; bytes: number }>(
    decisionScript({ elementId, resolutionsJson: JSON.stringify(resolutions) }),
    "WriteTransaction",
    "takeoff-decision.cs",
  );
