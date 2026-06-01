import { PeHostClient, type HostProbeData, type HostSessionSummaryData, type HostWorkbenchResourcesData, type HostResourceFileStateData, type RevitAgentContextSummaryData, type RevitAgentVisibleCategorySummary } from "./host-client.js";
import { callHostOperation } from "./host-operation-runtime.js";

export interface PeaContextProviderOptions {
  hostBaseUrl: string;
  workspaceKey: string;
  cwd: string;
  settingsPath: string;
  timeoutMs?: number;
}

export interface PeaContextProviderRequestContext {
  threadId?: string;
}

export type PeaContextProvider = (
  context?: PeaContextProviderRequestContext,
) => Promise<string>;

export type PeaContextSeedOptions = PeaContextProviderOptions;
export type PeaContextSeedRequestContext = PeaContextProviderRequestContext;
export type PeaContextSeedProvider = PeaContextProvider;

interface HostSeedFacts {
  probe?: HostProbeData;
  sessionSummary?: HostSessionSummaryData;
  errors: string[];
}

interface StartupContext {
  text: string;
  status: HostStatusSnapshot;
}

interface ThreadContextState {
  startup?: Promise<StartupContext>;
  lastStatusSignature?: string;
  lastStatusCheckedAt?: number;
  statusCheckCount: number;
}

interface HostStatusSnapshot {
  signature: string;
}

const fallbackCacheKey = "__pea_context__";
const defaultTimeoutMs = 2_500;

export function createPeaContextProvider(
  options: PeaContextProviderOptions,
): PeaContextProvider {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const threads = new Map<string, ThreadContextState>();

  return async (context) => {
    const cacheKey = firstNonBlank(context?.threadId) ?? fallbackCacheKey;
    let state = threads.get(cacheKey);
    if (!state) {
      state = { statusCheckCount: 0 };
      threads.set(cacheKey, state);
    }

    const startup = await getStartupContext(state, options, timeoutMs);
    if (state.statusCheckCount === 0) {
      updateStatusState(state, startup.status);
      state.statusCheckCount = 1;
      return startup.text;
    }

    const currentStatus = await collectStatusSnapshot(options.hostBaseUrl, timeoutMs);
    state.statusCheckCount += 1;
    state.lastStatusCheckedAt = Date.now();

    if (currentStatus.signature === state.lastStatusSignature)
      return startup.text;

    updateStatusState(state, currentStatus);
    return `${startup.text}\n\n${formatStatusChange()}`;
  };
}

export function createPeaContextSeedProvider(
  options: PeaContextSeedOptions,
): PeaContextSeedProvider {
  return createPeaContextProvider(options);
}

async function getStartupContext(
  state: ThreadContextState,
  options: PeaContextProviderOptions,
  timeoutMs: number,
): Promise<StartupContext> {
  state.startup ??= collectAndFormatStartupContext(options, timeoutMs);
  return state.startup;
}

async function collectAndFormatStartupContext(
  options: PeaContextProviderOptions,
  timeoutMs: number,
): Promise<StartupContext> {
  const hostFacts = await collectHostFacts(options.hostBaseUrl, timeoutMs);
  const shouldCollectRevitContext =
    hostFacts.probe?.bridgeIsConnected === true ||
    hostFacts.sessionSummary?.bridgeIsConnected === true;

  const revitContext = shouldCollectRevitContext
    ? await collectRevitContext(options.hostBaseUrl, timeoutMs).catch(
      (error: unknown) => `request failed: ${formatError(error)}`,
    )
    : undefined;

  return {
    text: formatSeed(options, hostFacts.sessionSummary?.workbenchResources, revitContext),
    status: createStatusSnapshot(options.hostBaseUrl, hostFacts),
  };
}

async function collectStatusSnapshot(
  hostBaseUrl: string,
  timeoutMs: number,
): Promise<HostStatusSnapshot> {
  return createStatusSnapshot(hostBaseUrl, await collectHostFacts(hostBaseUrl, timeoutMs));
}

async function collectHostFacts(
  hostBaseUrl: string,
  timeoutMs: number,
): Promise<HostSeedFacts> {
  const hostClient = new PeHostClient({
    baseUrl: hostBaseUrl,
    fetch: createTimeoutFetch(timeoutMs),
  });

  const [probeResult, sessionResult] = await Promise.allSettled([
    hostClient.host.getProbe(),
    hostClient.host.getSessionSummary(),
  ]);

  const errors: string[] = [];
  if (probeResult.status === "rejected")
    errors.push(`probe unavailable: ${formatError(probeResult.reason)}`);
  if (sessionResult.status === "rejected")
    errors.push(`session summary unavailable: ${formatError(sessionResult.reason)}`);

  return {
    probe: probeResult.status === "fulfilled" ? probeResult.value : undefined,
    sessionSummary: sessionResult.status === "fulfilled"
      ? sessionResult.value
      : undefined,
    errors,
  };
}

async function collectRevitContext(
  hostBaseUrl: string,
  timeoutMs: number,
): Promise<RevitAgentContextSummaryData | string> {
  const result = await callHostOperation(
    { baseUrl: hostBaseUrl, fetch: createTimeoutFetch(timeoutMs) },
    "revit.context.summary",
  );

  if (!result.ok)
    return result.message;

  return result.response as RevitAgentContextSummaryData;
}

function createStatusSnapshot(
  hostBaseUrl: string,
  hostFacts: HostSeedFacts,
): HostStatusSnapshot {
  const probe = hostFacts.probe;
  const session = hostFacts.sessionSummary;
  const activeDocument = session?.activeDocument;
  const normalized = {
    hostBaseUrl,
    hostReachable: Boolean(probe || session),
    runtimeIdentity: probe?.runtimeIdentity ?? null,
    hostContractVersion: probe?.hostContractVersion ?? null,
    bridgeContractVersion: probe?.bridgeContractVersion ?? null,
    bridgeIsConnected: probe?.bridgeIsConnected ?? session?.bridgeIsConnected ?? null,
    disconnectReason: normalizeBlank(probe?.disconnectReason),
    sessionId: normalizeBlank(session?.sessionId),
    revitVersion: normalizeBlank(session?.revitVersion),
    processId: session?.processId ?? null,
    openDocumentCount: session?.openDocumentCount ?? null,
    activeDocument: activeDocument
      ? {
        key: normalizeBlank(activeDocument.key),
        title: normalizeBlank(activeDocument.title),
        path: normalizeBlank(activeDocument.path),
        isFamilyDocument: activeDocument.isFamilyDocument,
        isWorkshared: activeDocument.isWorkshared,
        isModelInCloud: activeDocument.isModelInCloud,
      }
      : null,
    workbenchResources: session?.workbenchResources ?? null,
    errors: hostFacts.errors,
  };

  return {
    signature: JSON.stringify(normalized),
  };
}

function updateStatusState(
  state: ThreadContextState,
  status: HostStatusSnapshot,
): void {
  state.lastStatusSignature = status.signature;
  state.lastStatusCheckedAt = Date.now();
}

function formatSeed(
  options: PeaContextProviderOptions,
  workbenchResources: HostWorkbenchResourcesData | undefined,
  revitContext?: RevitAgentContextSummaryData | string,
): string {
  const lines = [
    "<pea-startup-context>",
    "Scope: transient thread-start orientation only. Pea checks cheap host/session status each turn internally and only injects a compact invalidation notice when stable status differs.",
    ...formatWorkbenchLines(options, workbenchResources),
    ...formatRevitContextLines(revitContext),
    "</pea-startup-context>",
  ];

  return escapeXmlBlock(lines);
}

function formatWorkbenchLines(
  options: PeaContextProviderOptions,
  workbenchResources: HostWorkbenchResourcesData | undefined,
): string[] {
  return [
    `workspace: cwd=${q(options.cwd)} workspaceKey=${q(options.workspaceKey)} settingsPath=${q(options.settingsPath)}`,
    formatParameterResourcesLine(workbenchResources),
    "scripting-workspace: use script_bootstrap when paths/references are unknown; workspace docs are README.md, AGENTS.md, and JOIN_GUIDE.md; source lives under src/.",
    "capabilities: use host_operation_search for generated public operations, then host_operation_call when a generated operation fits.",
    "scripts: use script_execute for tiny inline probes or durable workspace scripts; default ReadOnly and use WriteTransaction only for explicit mutations.",
    "evidence: prefer diagnostics, follow-up reads, and CSV/JSON/text artifacts over wide terminal output.",
  ];
}

function formatParameterResourcesLine(resources: HostWorkbenchResourcesData | undefined): string {
  if (!resources)
    return "parameter-resources: unavailable from host session summary; use pe_status when resource paths or freshness matter.";

  const parameters = resources.parameters;
  const cacheFiles = parameters.parameterServiceCacheFiles
    .map((file) => `${file.label.replace("parameters-service-cache.", "")}:${formatFileState(file)}`)
    .join(" ");
  const sharedParameters = parameters.sharedParametersFile.path
    ? `${q(parameters.sharedParametersFile.path)} ${formatFileState(parameters.sharedParametersFile)}`
    : parameters.sharedParametersFile.note;

  return `parameter-resources: stateDir=${q(parameters.globalStateDirectoryPath)} cache=[${cacheFiles}] sharedParameterFile=${sharedParameters}`;
}

function formatFileState(file: HostResourceFileStateData): string {
  const provenance = ` provenance=${q(file.provenance)}`;
  if (!file.exists)
    return file.path ? `missing path=${q(file.path)}${provenance}` : `unknown${provenance}`;

  return `exists mtimeMs=${file.lastWriteTimeUnixMs} sizeBytes=${file.sizeBytes} path=${q(file.path ?? "")}${provenance}`;
}

function formatStatusChange(): string {
  const lines = [
    "<pea-status-change>",
    "Cheap Pe.Host/session status changed since the previous turn.",
    "Treat this as invalidation only, not authoritative document context.",
    "Trust fresh bridge-backed reads such as host_operation_call key=revit.context.summary over this notice.",
    "Use pe_status only when host, bridge, session, active-document, workspace, or log-location details matter.",
    "</pea-status-change>",
  ];

  return escapeXmlBlock(lines);
}

function formatRevitContextLines(
  revitContext: RevitAgentContextSummaryData | string | undefined,
): string[] {
  if (!revitContext)
    return ["revit-context: not collected at startup. Use pe_status for bridge/session state and host_operation_call key=revit.context.summary for current Revit context."];

  if (typeof revitContext === "string")
    return [`revit-context: unavailable from revit.context.summary: ${revitContext}. Use pe_status, then pe_logs if needed.`];

  const lines: string[] = [];
  const activeDocument = revitContext.documents.activeDocument;
  if (activeDocument) {
    lines.push(`context-document: ${q(activeDocument.title)} key=${q(activeDocument.documentKey)} family=${activeDocument.isFamilyDocument} workshared=${activeDocument.isWorkshared} readOnly=${activeDocument.isReadOnly}`);
  }

  if (revitContext.activeView) {
    const view = revitContext.activeView;
    const sheetPlacements = view.sheetPlacements
      .slice(0, 3)
      .map((placement) => `${placement.sheetNumber} ${placement.sheetName}`)
      .join(", ");
    lines.push(`active-view: ${q(view.title)} type=${q(view.viewType)} scale=${view.scale} sheet=${view.isSheet} schedule=${view.isSchedule} level=${q(view.levelName ?? "-")} placements=${q(sheetPlacements || "-")}`);
  } else {
    lines.push("active-view: none reported.");
  }

  lines.push(`selection: selected=${revitContext.selection.selectedElementCount} returned=${revitContext.selection.returnedElementCount}${formatSelectionSamples(revitContext.selection.entries)}`);
  lines.push(`browser: views=${revitContext.browser.viewCount} sheets=${revitContext.browser.sheetCount} schedules=${revitContext.browser.scheduleCount} families=${revitContext.browser.familyCount}`);
  lines.push(formatVisibleCategoriesLine(revitContext.visibleCategories));

  return lines;
}

function formatSelectionSamples(
  entries: RevitAgentContextSummaryData["selection"]["entries"],
): string {
  const samples = entries.slice(0, 3).map((entry) => {
    const detail = [
      entry.className,
      entry.familyName,
      entry.typeName,
      entry.levelName,
    ].filter(Boolean).join("/");
    return `${entry.handle.label}${detail ? ` (${detail})` : ""}`;
  });

  return samples.length > 0 ? ` samples=${q(samples.join("; "))}` : "";
}

function formatVisibleCategoriesLine(
  categories: RevitAgentVisibleCategorySummary[],
): string {
  if (categories.length === 0)
    return "visible-categories: none returned.";

  const topCategories = [...categories]
    .sort((left, right) => right.elementCount - left.elementCount)
    .slice(0, 8)
    .map((category) => {
      const samples = category.sampleElements
        .slice(0, 2)
        .map((sample) => [
          sample.handle.label,
          sample.className,
          sample.familyName,
          sample.typeName,
        ].filter(Boolean).join("/"));
      const sampleText = samples.length > 0 ? ` samples=${samples.join("; ")}` : "";
      return `${category.handle.label}:${category.elementCount}${sampleText}`;
    });

  return `visible-categories: ${topCategories.join(" | ")}`;
}

function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };
}

function normalizeBlank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatError(error: unknown): string {
  if (error instanceof Error)
    return error.message;

  return String(error);
}

function q(value: string): string {
  return JSON.stringify(value);
}

function firstNonBlank(value: string | undefined): string | undefined {
  return value != null && value.trim().length > 0 ? value.trim() : undefined;
}

function escapeXmlBlock(lines: string[]): string {
  return lines
    .map((line, index) => index === 0 || index === lines.length - 1
      ? line
      : escapeXmlText(line))
    .join("\n");
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
