import { hostProcessIdentity, scriptingWorkspaceIdentity } from "@pe/host-generated/contracts";
import type { HostOperationKey } from "@pe/host-generated/contracts";
import {
  listHostOperations,
  getHostOperation,
  searchHostOperations,
  callHostOperation,
  type HostOperationSearchOptions,
  type HostOperationSearchOutput,
  type HostOperationCallResult,
  type HostOperationVerbosity,
} from "./runtime.ts";
import {
  callHostOp,
  callHostOpDetailed,
  HostCallError,
  type HostCallOptions,
  type HostCallResult,
  type HostOpResponse,
} from "./call.ts";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { HostOperationDefinition } from "@pe/host-generated/contracts";

// The generic caller and its types are the public boundary; re-export so callers
// import everything from `@pe/host-client`.
export { callHostOp, callHostOpDetailed, sendHostRequest, HostCallError } from "./call.ts";
export type {
  HostCallOptions,
  HostCallResult,
  HostOpResponse,
  HostProblemDetails,
} from "./call.ts";
export {
  HostLogTarget,
  ScriptExecutionSourceKind,
  ScriptPermissionMode,
} from "@pe/host-generated/types";
export type {
  ExecuteRevitScriptData,
  ExecuteRevitScriptRequest,
  HostActiveDocumentSummary,
  HostLogsData,
  HostLogsRequest,
  HostProbeData,
  HostResourceFileStateData,
  HostSessionSummaryData,
  HostWorkbenchResourcesData,
  RevitAgentContextSummaryData,
  RevitAgentVisibleCategorySummary,
  ScriptDiagnostic,
  ScriptPodExportData,
  ScriptPodExportRequest,
  ScriptPodImportData,
  ScriptPodImportRequest,
  ScriptWorkspaceBootstrapData,
  ScriptWorkspaceBootstrapRequest,
} from "@pe/host-generated/zod";

export interface PeHostClientOptions extends HostCallOptions {
  baseUrl: string;
}

export class PeHostClient {
  readonly general: GeneralClient;
  private readonly options: PeHostClientOptions;

  constructor(options?: Partial<PeHostClientOptions>) {
    this.options = {
      ...options,
      baseUrl: options?.baseUrl ?? hostProcessIdentity.defaultHostBaseUrl,
    };
    this.general = new GeneralClient(this.options);
    void this.ensurePeHostRunning(this.options.baseUrl);
  }

  /** Call any host operation by key; request + response validated via the generated registry. */
  call<K extends HostOperationKey>(key: K, request?: unknown): Promise<HostOpResponse<K>> {
    return callHostOp(key, request, this.options);
  }

  callDetailed<K extends HostOperationKey>(key: K, request?: unknown): Promise<HostCallResult<K>> {
    return callHostOpDetailed(key, request, this.options);
  }

  static resolveHostBaseUrl(value?: string): string {
    return (
      firstNonBlank(value, process.env[hostProcessIdentity.hostBaseUrlVariable]) ??
      hostProcessIdentity.defaultHostBaseUrl
    );
  }

  static resolveWorkspaceKey(value?: string): string {
    return firstNonBlank(value) ?? scriptingWorkspaceIdentity.defaultWorkspaceKey;
  }

  static async resolveHostExecutablePath(): Promise<string | null> {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
    const candidates = [
      process.env[hostProcessIdentity.hostExecutablePathVariable],
      join(sourceRoot, "build", "bin", "Debug", "net10.0", hostProcessIdentity.executableName),
    ].filter((candidate): candidate is string => candidate != null && candidate.trim().length > 0);

    for (const candidate of candidates) {
      try {
        const resolved = resolve(candidate);
        const fileStat = await stat(resolved);
        if (fileStat.isFile()) return resolved;
      } catch {}
    }

    return null;
  }

  async ensurePeHostRunning(hostBaseUrl: string): Promise<void> {
    try {
      await this.call("settings.host-probe");
      return;
    } catch (error) {
      if (error instanceof HostCallError) return;
    }

    const hostExecutablePath = await PeHostClient.resolveHostExecutablePath();
    if (!hostExecutablePath) return;

    const child = spawn(hostExecutablePath, [], {
      cwd: dirname(hostExecutablePath),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();

    const deadline = Date.now() + 8000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      await delay(250);
      try {
        await this.call("settings.host-probe");
        return;
      } catch (error) {
        lastError = error;
        if (error instanceof HostCallError) return;
      }
    }

    const detail = lastError instanceof Error ? lastError.message : "unknown error";
    throw new Error(
      `Started Pe.Host from ${hostExecutablePath}, but it did not become reachable at ${hostBaseUrl} within 8 seconds. Last probe error: ${detail}`,
    );
  }
}

class GeneralClient {
  constructor(private readonly options: PeHostClientOptions) {}

  listOperations(): HostOperationDefinition[] {
    return listHostOperations();
  }

  getOperation(key: string): HostOperationDefinition | undefined {
    return getHostOperation(key);
  }

  searchOperations(options: HostOperationSearchOptions = {}): HostOperationSearchOutput {
    return searchHostOperations(options);
  }

  callOperation(
    key: string,
    request?: unknown,
    verbosity: HostOperationVerbosity = "compact",
  ): Promise<HostOperationCallResult> {
    return callHostOperation(this.options, key, request, verbosity);
  }
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value.trim().length > 0)?.trim();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
