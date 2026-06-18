import {
  hostOperations,
  hostProcessIdentity,
  scriptingWorkspaceIdentity,
} from "@pe/host-generated/contracts";
import type { HostOperationDefinition } from "@pe/host-generated/contracts";
import {
  HostModuleActiveDocumentKind,
  HostModuleScope,
  ScriptDiagnosticSeverity,
  ScriptExecutionStatus,
  ScriptPodTransferStatus,
} from "@pe/host-generated/types";
import type {
  ExecuteRevitScriptData,
  ExecuteRevitScriptRequest,
  HostActiveDocumentSummary,
  HostLogFileData,
  HostLogsData,
  HostLogsRequest,
  HostModuleDescriptor,
  HostParameterResourceData,
  HostProbeData,
  HostResourceFileStateData,
  HostRuntimeAssemblyData,
  HostSessionSummaryData,
  HostWorkbenchResourcesData,
  ScriptArtifactData,
  ScriptDiagnostic,
  ScriptPodEntrypointData,
  ScriptPodExportData,
  ScriptPodExportRequest,
  ScriptPodImportData,
  ScriptPodImportRequest,
  ScriptPodManifestSummaryData,
  ScriptPodOriginData,
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
import { z } from "zod";

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
    return sendHostJson(
      this.options,
      hostOperations["settings.host-probe"],
      undefined,
      isHostProbeData,
    );
  }

  getSessionSummary(): Promise<HostSessionSummaryData> {
    return sendHostJson(
      this.options,
      hostOperations["settings.session-summary"],
      undefined,
      isHostSessionSummaryData,
    );
  }

  getLogs(request: HostLogsRequest): Promise<HostLogsData> {
    return sendHostJson(this.options, hostOperations["host.logs"], request, isHostLogsData);
  }
}

class ScriptingClient {
  constructor(private readonly options: PeHostClientOptions) {}

  bootstrapWorkspace(
    request: ScriptWorkspaceBootstrapRequest,
  ): Promise<ScriptWorkspaceBootstrapData> {
    return sendHostJson(
      this.options,
      hostOperations["scripting.workspace.bootstrap"],
      request,
      isScriptWorkspaceBootstrapData,
    );
  }

  execute(request: ExecuteRevitScriptRequest): Promise<ExecuteRevitScriptData> {
    return sendHostJson(
      this.options,
      hostOperations["scripting.execute"],
      request,
      isExecuteRevitScriptData,
    );
  }

  importPod(request: ScriptPodImportRequest): Promise<ScriptPodImportData> {
    return sendHostJson(
      this.options,
      hostOperations["scripting.pod.import"],
      request,
      isScriptPodImportData,
    );
  }

  exportPod(request: ScriptPodExportRequest): Promise<ScriptPodExportData> {
    return sendHostJson(
      this.options,
      hostOperations["scripting.pod.export"],
      request,
      isScriptPodExportData,
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

async function sendHostJson<TRequest, TResponse>(
  options: PeHostClientOptions,
  operation: HostOperationDefinition,
  request: TRequest,
  readResponse: (value: unknown) => value is TResponse,
): Promise<TResponse> {
  const value = await sendJson(options, operation, request);
  if (readResponse(value)) return value;
  throw new Error(`Pe.Host ${operation.key} returned an unexpected response shape.`);
}

export async function sendJson<TRequest>(
  options: PeHostClientOptions,
  operation: HostOperationDefinition,
  request?: TRequest,
): Promise<unknown> {
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
    const problem = readHostProblemDetails(parseJson(text));
    throw new PeHostClientError(
      problem?.detail ?? problem?.title ?? (text || `${response.status} ${response.statusText}`),
      response.status,
      problem,
    );
  }

  return text ? JSON.parse(text) : undefined;
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

function parseJson(text: string): unknown {
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const hostStringArraySchema = z.array(z.string());
const hostProblemDetailsSchema: z.ZodType<HostProblemDetails> = z
  .object({
    type: z.string().optional(),
    title: z.string().optional(),
    status: z.number().optional(),
    detail: z.string().optional(),
    instance: z.string().optional(),
  })
  .strip();
const hostResourceFileStateDataSchema: z.ZodType<HostResourceFileStateData> = z
  .object({
    label: z.string(),
    path: z.string().optional(),
    exists: z.boolean(),
    lastWriteTimeUnixMs: z.number().optional(),
    sizeBytes: z.number().optional(),
    provenance: z.string(),
    note: z.string().optional(),
  })
  .strip();
const hostParameterResourceDataSchema: z.ZodType<HostParameterResourceData> = z
  .object({
    globalStateDirectoryPath: z.string(),
    parameterServiceCacheFiles: z.array(hostResourceFileStateDataSchema),
    sharedParametersFile: hostResourceFileStateDataSchema,
  })
  .strip();
const hostWorkbenchResourcesDataSchema: z.ZodType<HostWorkbenchResourcesData> = z
  .object({
    parameters: hostParameterResourceDataSchema,
  })
  .strip();
const hostActiveDocumentSummarySchema: z.ZodType<HostActiveDocumentSummary> = z
  .object({
    title: z.string().optional(),
    key: z.string().optional(),
    path: z.string().optional(),
    isFamilyDocument: z.boolean(),
    isWorkshared: z.boolean(),
    isModelInCloud: z.boolean(),
    cloudProjectGuid: z.string().optional(),
    cloudModelGuid: z.string().optional(),
    cloudModelUrn: z.string().optional(),
    observedAtUnixMs: z.number(),
  })
  .strip();
const hostRuntimeAssemblyDataSchema: z.ZodType<HostRuntimeAssemblyData> = z
  .object({
    name: z.string(),
    version: z.string().optional(),
    informationalVersion: z.string().optional(),
    location: z.string().optional(),
    moduleVersionId: z.string(),
  })
  .strip();
const hostModuleDescriptorSchema: z.ZodType<HostModuleDescriptor> = z
  .object({
    moduleKey: z.string(),
    defaultRootKey: z.string(),
    scope: z.nativeEnum(HostModuleScope),
    activeDocumentKind: z.nativeEnum(HostModuleActiveDocumentKind),
  })
  .strip();
const hostLogFileDataSchema: z.ZodType<HostLogFileData> = z
  .object({
    label: z.string(),
    filePath: z.string(),
    lines: hostStringArraySchema,
  })
  .strip();
const scriptDiagnosticSchema: z.ZodType<ScriptDiagnostic> = z
  .object({
    stage: z.string(),
    severity: z.nativeEnum(ScriptDiagnosticSeverity),
    message: z.string(),
    source: z.string().optional(),
  })
  .strip();
const scriptArtifactDataSchema: z.ZodType<ScriptArtifactData> = z
  .object({
    name: z.string(),
    relativePath: z.string(),
    fullPath: z.string(),
    contentType: z.string(),
    sizeBytes: z.number(),
  })
  .strip();
const scriptPodOriginDataSchema: z.ZodType<ScriptPodOriginData> = z
  .object({ path: z.string() })
  .strip();
const scriptPodEntrypointDataSchema: z.ZodType<ScriptPodEntrypointData> = z
  .object({
    id: z.string(),
    sourcePath: z.string(),
    name: z.string().optional(),
  })
  .strip();
const scriptPodManifestSummaryDataSchema: z.ZodType<ScriptPodManifestSummaryData> = z
  .object({
    schemaVersion: z.number(),
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    origin: scriptPodOriginDataSchema.optional(),
    entrypoints: z.array(scriptPodEntrypointDataSchema),
  })
  .strip();
const hostProbeDataSchema: z.ZodType<HostProbeData> = z
  .object({
    runtimeIdentity: z.string(),
    hostContractVersion: z.number(),
    bridgeContractVersion: z.number(),
    bridgePath: z.string(),
    bridgeIsConnected: z.boolean(),
    disconnectReason: z.string().optional(),
  })
  .strip();
const hostSessionSummaryDataSchema: z.ZodType<HostSessionSummaryData> = z
  .object({
    bridgeIsConnected: z.boolean(),
    sessionId: z.string().optional(),
    processId: z.number().optional(),
    revitVersion: z.string().optional(),
    runtimeFramework: z.string().optional(),
    openDocumentCount: z.number(),
    activeDocument: hostActiveDocumentSummarySchema.optional(),
    runtimeAssemblies: z.array(hostRuntimeAssemblyDataSchema),
    availableModules: z.array(hostModuleDescriptorSchema),
    workbenchResources: hostWorkbenchResourcesDataSchema,
  })
  .strip();
const hostLogsDataSchema: z.ZodType<HostLogsData> = z
  .object({ files: z.array(hostLogFileDataSchema) })
  .strip();
const scriptWorkspaceBootstrapDataSchema: z.ZodType<ScriptWorkspaceBootstrapData> = z
  .object({
    workspaceKey: z.string(),
    productHomePath: z.string(),
    productAgentsPath: z.string(),
    productReadmePath: z.string(),
    workspaceRootPath: z.string(),
    workspaceAgentsPath: z.string(),
    workspaceReadmePath: z.string(),
    projectFilePath: z.string(),
    sampleScriptPath: z.string(),
    revitVersion: z.string(),
    targetFramework: z.string(),
    runtimeAssemblyPath: z.string(),
    generatedFiles: hostStringArraySchema,
  })
  .strip();
const executeRevitScriptDataSchema: z.ZodType<ExecuteRevitScriptData> = z
  .object({
    status: z.nativeEnum(ScriptExecutionStatus),
    output: z.string(),
    diagnostics: z.array(scriptDiagnosticSchema),
    revitVersion: z.string(),
    targetFramework: z.string(),
    containerTypeName: z.string().optional(),
    executionId: z.string(),
    artifacts: z.array(scriptArtifactDataSchema).optional(),
  })
  .strip();
const scriptPodImportDataSchema: z.ZodType<ScriptPodImportData> = z
  .object({
    status: z.nativeEnum(ScriptPodTransferStatus),
    workspaceKey: z.string().optional(),
    workspaceRootPath: z.string().optional(),
    archivePath: z.string(),
    manifest: scriptPodManifestSummaryDataSchema.optional(),
    archiveEntries: hostStringArraySchema,
    generatedFiles: hostStringArraySchema,
    diagnostics: z.array(scriptDiagnosticSchema),
  })
  .strip();
const scriptPodExportDataSchema: z.ZodType<ScriptPodExportData> = z
  .object({
    status: z.nativeEnum(ScriptPodTransferStatus),
    workspaceKey: z.string().optional(),
    workspaceRootPath: z.string().optional(),
    archivePath: z.string(),
    manifest: scriptPodManifestSummaryDataSchema.optional(),
    archiveEntries: hostStringArraySchema,
    diagnostics: z.array(scriptDiagnosticSchema),
  })
  .strip();

function readHostProblemDetails(value: unknown): HostProblemDetails | undefined {
  const problem = hostProblemDetailsSchema.safeParse(value);
  return problem.success ? problem.data : undefined;
}

function isHostProbeData(value: unknown): value is HostProbeData {
  return isSchema(hostProbeDataSchema, value);
}

function isHostSessionSummaryData(value: unknown): value is HostSessionSummaryData {
  return isSchema(hostSessionSummaryDataSchema, value);
}

function isHostLogsData(value: unknown): value is HostLogsData {
  return isSchema(hostLogsDataSchema, value);
}

function isScriptWorkspaceBootstrapData(value: unknown): value is ScriptWorkspaceBootstrapData {
  return isSchema(scriptWorkspaceBootstrapDataSchema, value);
}

function isExecuteRevitScriptData(value: unknown): value is ExecuteRevitScriptData {
  return isSchema(executeRevitScriptDataSchema, value);
}

function isScriptPodImportData(value: unknown): value is ScriptPodImportData {
  return isSchema(scriptPodImportDataSchema, value);
}

function isScriptPodExportData(value: unknown): value is ScriptPodExportData {
  return isSchema(scriptPodExportDataSchema, value);
}

function isSchema<T>(schema: z.ZodType<T>, value: unknown): value is T {
  return schema.safeParse(value).success;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
