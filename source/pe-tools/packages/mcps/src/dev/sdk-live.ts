import { runPeRevitWorkflow, type WorkflowCommandResult } from "./pe-revit-workflow/index.js";

interface LastSyncResult {
  checkedAt: string;
  result: WorkflowCommandResult;
}

let lastSyncResult: LastSyncResult | null = null;

export async function runSdkLiveSync(request: {
  timeoutSeconds: number;
  project?: string;
  revitYear?: string;
}): Promise<WorkflowCommandResult> {
  const args = ["live", "--json"];
  if (request.project) args.push("--project", request.project);
  if (request.revitYear) args.push("--year", request.revitYear);

  const result = await runPeRevitWorkflow("live", args, "RrdRequired", request.timeoutSeconds);
  rememberLastSyncResult(result);
  return result;
}

function rememberLastSyncResult(result: WorkflowCommandResult): void {
  lastSyncResult = {
    checkedAt: new Date().toISOString(),
    result,
  };
}

export function summarizeLastSyncResult() {
  if (lastSyncResult == null) return null;

  const result = lastSyncResult.result;
  const json = readRecord(result.json);
  const verdict = readSdkLiveVerdict(result);
  const assemblyVerdict = readString(json, "assemblyVerdict") ?? verdict;

  return {
    checkedAt: lastSyncResult.checkedAt,
    lane: "pe-revit",
    ok: result.ok,
    verdict,
    loadedGraphVerdict: assemblyVerdict,
    sourceDeltaVerdict: verdict,
    actionStatuses: [],
    proofSummary: readString(json, "note") ?? `pe-revit live ${result.ok ? "succeeded" : "failed"}`,
    guidance: null,
  };
}

export function sdkLiveWarning(result: WorkflowCommandResult): string | null {
  const json = readRecord(result.json);
  const warning = readString(json, "warning");
  if (warning) return warning;
  if (result.ok) return null;
  const fallback = readString(json, "note") ?? result.stderrTail;
  return fallback || "SDK live failed.";
}

function readSdkLiveVerdict(result: WorkflowCommandResult): string {
  return readString(readRecord(result.json), "verdict") ?? (result.ok ? "unproven" : "failed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}
