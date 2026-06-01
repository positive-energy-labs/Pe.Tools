import type { WorkflowCommandResult } from "./pe-dev-workflow/index.js";
import {
  defaultRiderBridgeBaseUrl,
  runRiderBridgeSync,
} from "./rider/index.js";

export type AttachedRrdStalePolicy = "warn" | "fail";

export class AttachedRrdFreshnessError extends Error {
  constructor(
    message: string,
    public readonly syncResult: WorkflowCommandResult,
    public readonly warning: string,
  ) {
    super(message);
    this.name = "AttachedRrdFreshnessError";
  }
}

export async function runWithAttachedRrdSync<T>(
  request: {
    workflow: string;
    stalePolicy: AttachedRrdStalePolicy;
    timeoutSeconds: number;
  },
  run: (syncResult: WorkflowCommandResult, warning: string | null) => Promise<T>,
): Promise<{ sync: WorkflowCommandResult; warning: string | null; result: T }> {
  const sync = await runRiderBridgeSync({
    timeoutSeconds: request.timeoutSeconds,
    riderBridgeBaseUrl: defaultRiderBridgeBaseUrl,
    project: "Pe.Tools",
  });
  const warning = attachedRrdFreshnessWarning(sync, request.workflow);

  if (request.stalePolicy === "fail" && shouldFailOnFreshness(sync)) {
    throw new AttachedRrdFreshnessError(
      warning ?? `AttachedRrd sync before ${request.workflow} did not prove runtime freshness.`,
      sync,
      warning ?? "AttachedRrd sync did not prove runtime freshness.",
    );
  }

  return {
    sync,
    warning,
    result: await run(sync, warning),
  };
}

export function attachedRrdFreshnessWarning(
  syncResult: WorkflowCommandResult,
  workflow: string,
): string | null {
  if (syncResult.ok && syncResult.runtimeFreshness?.verdict === "fresh")
    return null;

  const verdict = syncResult.runtimeFreshness?.verdict ?? "unknown";
  return `WARNING: RiderBridge sync before ${workflow} reported runtime freshness '${verdict}'. Continue only as AttachedRrd behavior evidence, not fresh runtime proof.`;
}

function shouldFailOnFreshness(syncResult: WorkflowCommandResult): boolean {
  return !syncResult.ok || syncResult.runtimeFreshness?.verdict === "stale";
}
