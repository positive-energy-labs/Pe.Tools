import {
  hostOperations,
  hostProcessIdentity,
  scriptingWorkspaceIdentity,
} from "@pe/host-generated/contracts";
import type { HostOperationDefinition } from "@pe/host-generated/contracts";
import type {
  ExecuteRevitScriptData,
  ExecuteRevitScriptRequest,
  HostLogsData,
  HostLogsRequest,
  HostProbeData,
  HostSessionSummaryData,
  ScriptPodExportData,
  ScriptPodExportRequest,
  ScriptPodImportData,
  ScriptPodImportRequest,
  ScriptWorkspaceBootstrapData,
  ScriptWorkspaceBootstrapRequest,
} from "@pe/host-generated/types";
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
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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
} from "@pe/host-generated/types";
import { dirname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";

// TODO: think about the api here. should special timeouts be specifiable only thru the client contructor? I think probably
export class PeHostClient {
  readonly general: GeneralClient;
  readonly host: HostClient;
  readonly scripting: ScriptingClient;

  constructor(options?: PeHostClientOptions) {
    options = options?.baseUrl
      ? options
      : { ...options, baseUrl: hostProcessIdentity.defaultHostBaseUrl };
    this.general = new GeneralClient(options);
    this.host = new HostClient(options);
    this.scripting = new ScriptingClient(options);
    void this.ensurePeHostRunning(options.baseUrl);
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
      await this.host.getProbe();
      return;
    } catch (error) {
      if (error instanceof PeHostClientError) return;
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
        await this.host.getProbe();
        return;
      } catch (error) {
        lastError = error;
        if (error instanceof PeHostClientError) return;
      }
    }

    const detail = lastError instanceof Error ? lastError.message : "unknown error";
    throw new Error(
      `Started Pe.Host from ${hostExecutablePath}, but it did not become reachable at ${hostBaseUrl} within 8 seconds. Last probe error: ${detail}`,
    );
  }
}

// TODO: squash the sendJson and host op call implementations
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

// TODO: squash the sendJson and host op call implementations
class HostClient {
  constructor(private readonly options: PeHostClientOptions) {}

  getProbe(): Promise<HostProbeData> {
    return sendJson<void, HostProbeData>(this.options, hostOperations["settings.host-probe"]);
  }

  getSessionSummary(): Promise<HostSessionSummaryData> {
    return sendJson<void, HostSessionSummaryData>(
      this.options,
      hostOperations["settings.session-summary"],
    );
  }

  getLogs(request: HostLogsRequest): Promise<HostLogsData> {
    return sendJson<HostLogsRequest, HostLogsData>(
      this.options,
      hostOperations["host.logs"],
      request,
    );
  }
}

class ScriptingClient {
  constructor(private readonly options: PeHostClientOptions) {}

  bootstrapWorkspace(
    request: ScriptWorkspaceBootstrapRequest,
  ): Promise<ScriptWorkspaceBootstrapData> {
    return sendJson<ScriptWorkspaceBootstrapRequest, ScriptWorkspaceBootstrapData>(
      this.options,
      hostOperations["scripting.workspace.bootstrap"],
      request,
    );
  }

  execute(request: ExecuteRevitScriptRequest): Promise<ExecuteRevitScriptData> {
    return sendJson<ExecuteRevitScriptRequest, ExecuteRevitScriptData>(
      this.options,
      hostOperations["scripting.execute"],
      request,
    );
  }

  importPod(request: ScriptPodImportRequest): Promise<ScriptPodImportData> {
    return sendJson<ScriptPodImportRequest, ScriptPodImportData>(
      this.options,
      hostOperations["scripting.pod.import"],
      request,
    );
  }

  exportPod(request: ScriptPodExportRequest): Promise<ScriptPodExportData> {
    return sendJson<ScriptPodExportRequest, ScriptPodExportData>(
      this.options,
      hostOperations["scripting.pod.export"],
      request,
    );
  }
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value.trim().length > 0)?.trim();
}

export interface HostProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

export interface PeHostClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  requestId?: string;
  timeoutMs?: number;
}

export class PeHostClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly problem?: HostProblemDetails,
  ) {
    super(message);
    this.name = "PeHostClientError";
  }
}

export async function sendJson<TRequest, TResponse>(
  options: PeHostClientOptions,
  operation: HostOperationDefinition,
  request?: TRequest,
): Promise<TResponse> {
  const fetchImpl = options.fetch ?? fetch;
  const route =
    operation.verb === "GET" ? appendQueryString(operation.route, request) : operation.route;
  const headers = new Headers();
  let hasHeaders = false;
  if (operation.verb === "POST") {
    headers.set("Content-Type", "application/json");
    hasHeaders = true;
  }
  if (options.requestId) {
    headers.set("X-Pe-Request-Id", options.requestId);
    hasHeaders = true;
  }

  const controller = options.timeoutMs == null ? undefined : new AbortController();
  const timeout =
    controller == null
      ? undefined
      : setTimeout(() => controller.abort(), Math.max(options.timeoutMs ?? 0, 1));

  let response: Response;
  try {
    response = await fetchImpl(`${trimTrailingSlash(options.baseUrl)}${route}`, {
      method: operation.verb,
      headers: hasHeaders ? headers : undefined,
      body: operation.verb === "POST" ? JSON.stringify(request) : undefined,
      signal: controller?.signal,
    });
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    const problem = parseJson<HostProblemDetails>(text);
    throw new PeHostClientError(
      problem?.detail ?? problem?.title ?? (text || `${response.status} ${response.statusText}`),
      response.status,
      problem,
    );
  }

  return text ? (JSON.parse(text) as TResponse) : (undefined as TResponse);
}

function appendQueryString<TRequest>(route: string, request?: TRequest): string {
  if (!request) return route;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request)) {
    if (value == null) continue;
    params.set(key, formatQueryValue(value));
  }

  const query = params.toString();
  if (!query) return route;

  return `${route}${route.includes("?") ? "&" : "?"}${query}`;
}

function formatQueryValue(value: unknown): string {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
      return value.toString();
    default:
      return JSON.stringify(value);
  }
}

function parseJson<T>(text: string): T | undefined {
  if (!text) return undefined;

  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
