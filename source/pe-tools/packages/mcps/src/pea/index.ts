import { createTool } from "@mastra/core/tools";
import z from "zod";
import {
  assertRuntimeToolAccess,
  createRuntimeToolProfile,
  readRuntimeAccessLevelFromToolContext,
} from "@pe/agent-contracts";
import { HostLogTarget, type HostOpResponse } from "@pe/host-contracts/operation-types";
import { HostRpcCaller } from "../shared/host-rpc-caller.js";

type ActiveDocumentSummary = NonNullable<
  HostOpResponse<"bridge.sessions.summary">["activeDocument"]
>;
import {
  ScriptingTools,
  scriptBootstrapInputSchema,
  scriptClientTimeoutMs,
  scriptExecuteInputSchema,
} from "../shared/scripting.ts";
import { readImage } from "../shared/read-image.ts";
import { coerceJsonObject } from "../shared/coerce.ts";
import { createCaptureViewTool } from "../shared/capture-view.ts";
import { requestAccess } from "../shared/request-access.ts";
import { revitApiFetch, revitApiSearch } from "../shared/rvt-api.ts";
import { resolveHostBaseUrl, resolveWorkspaceKey } from "../shared/host-config.ts";
import { peaProductToolCatalog } from "../tool-metadata.ts";
import { createPeSandboxTool, presentSessionKind } from "./sandbox.ts";
import { routeStateTools } from "./route-state.ts";
import { PeaCliCommands, type PeaCliCommandOptions } from "./PeaCliCommands.ts";
export { type RouteRegistration, createRouteRegistrations } from "./routes.ts";
export { peaProductToolCatalog } from "../tool-metadata.ts";
export { PeaCliCommands } from "./PeaCliCommands.ts";
export {
  bundledPeaSkills,
  materializeBundledPeaSkills,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  resolvePeaStandardSkillsRoot,
  peaSkillPaths,
  peaProductHomeEnvVar,
  peaStandardSkillsRoot,
} from "./skills.ts";

export const defaultPeaAgentModelId = "openai/gpt-5.6-terra";

type PeaProductToolContext = {
  hostBaseUrl?: string;
  workspaceKey?: string;
};

let peaProductToolContext: PeaProductToolContext = {};

export function configurePeaProductToolContext(context: PeaProductToolContext): void {
  peaProductToolContext = context;
}

const toolVerbositySchema = z.enum(["compact", "hints", "full"]);
const bridgeSessionIdSchema = z
  .string()
  .optional()
  .describe(
    "Optional target selector for a connected Revit session: 'user' (the user's own session — their live docs), 'sandbox:<id>' (a pea-owned sandbox from pe_sandbox), a pid, or a raw session id from pe_status sessions. With one session connected it may be omitted; with several, untargeted Revit operations hard-fail with the session listing.",
  );

const hostOperationSearchInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe("Natural-language or keyword query describing the capability you need."),
  domain: z
    .string()
    .optional()
    .describe("Optional exact top-level domain filter, such as revit or settings."),
  intent: z
    .enum(["Read", "Mutate"])
    .optional()
    .describe("Filter to read-only or mutating operations."),
  requiresActiveDocument: z
    .boolean()
    .optional()
    .describe("Filter by whether the operation needs an active Revit document."),
  limit: z.number().min(1).max(50).default(8).describe("Maximum ranked matches to return."),
  verbosity: toolVerbositySchema
    .default("compact")
    .describe(
      "Output size for projection=matches. Use compact by default; use hints for examples/expansion hints; use full only when you need metadata and full request/response shapes.",
    ),
  projection: z
    .enum(["matches", "capability-map"])
    .default("matches")
    .describe(
      "Use matches for ranked operation results. Use capability-map for broad orientation across generated host-operation ladders without adding separate tools.",
    ),
  capabilityMapFormat: z
    .enum(["markdown", "json", "toon"])
    .default("markdown")
    .describe(
      "Capability-map rendering format. Markdown is the default; json returns normalized rows; toon returns an optional TOON-style preview only, not a host response format.",
    ),
});

const scriptWorkspaceBootstrapDataSchema = z.object({
  workspaceKey: z.string(),
  productHomePath: z.string(),
  productAgentsPath: z.string(),
  productReadmePath: z.string(),
  workspaceRootPath: z.string(),
  workspaceAgentsPath: z.string(),
  workspaceReadmePath: z.string(),
  projectFilePath: z.string(),
  podManifestPath: z.string(),
  sampleScriptPath: z.string(),
  revitVersion: z.string(),
  targetFramework: z.string(),
  runtimeAssemblyPath: z.string(),
  generatedFiles: z.array(z.string()),
});

export const peStatus = createTool({
  id: "pe_status",
  description:
    "Read fresh host status: host, bridge/session, and active document. Call FIRST for orientation and whenever a call fails with a connectivity-shaped error. Use compact by default; full returns the raw probe/session DTOs.",
  inputSchema: z.object({
    verbosity: z
      .enum(["compact", "full"])
      .default("compact")
      .describe("compact for orientation; full for the raw probe/session DTOs."),
    bridgeSessionId: bridgeSessionIdSchema,
  }),
  execute: async (input) => {
    const hostRpcCaller = createCurrentHostRpcCaller(input.bridgeSessionId);
    const probe = await hostRpcCaller.call("host.status");
    const sessionSummary = await hostRpcCaller.call("bridge.sessions.summary");
    // Observed facts per connected session (lane/buildStamp as reported at registration).
    // Freshness/staleness is the SDK's to compute — pe_status only reports host connectivity.
    const sessionsList = await hostRpcCaller.call("bridge.sessions.list");
    if (input.verbosity === "full")
      return { probe, sessionSummary, sessions: sessionsList.sessions };

    return presentCompactStatus(probe, sessionSummary, sessionsList.sessions);
  },
});

/**
 * Compact pe_status presentation. Pea's world is "the user's session + pea-owned sandboxes":
 * every session presents as kind=user or kind=sandbox (with its id) — broker/SDK lane
 * vocabulary never reaches compact output. verbosity=full keeps the raw DTOs.
 */
export function presentCompactStatus(
  probe: HostOpResponse<"host.status">,
  sessionSummary: HostOpResponse<"bridge.sessions.summary">,
  sessions: HostOpResponse<"bridge.sessions.list">["sessions"],
) {
  return {
    bridge: {
      isConnected: probe.bridgeIsConnected,
      path: probe.bridgePath,
      disconnectReason: probe.disconnectReason,
    },
    contracts: {
      host: probe.hostContractVersion,
      bridge: probe.bridgeContractVersion,
    },
    session: {
      isConnected: sessionSummary.bridgeIsConnected,
      sessionId: sessionSummary.sessionId,
      processId: sessionSummary.processId,
      ...presentSessionKind(sessionSummary.lane, sessionSummary.sandboxId),
      buildStamp: sessionSummary.buildStamp,
      revitVersion: sessionSummary.revitVersion,
      openDocumentCount: sessionSummary.openDocumentCount,
      activeDocument:
        sessionSummary.activeDocument == null
          ? undefined
          : summarizeActiveDocument(sessionSummary.activeDocument),
      availableModuleCount: sessionSummary.availableModules.length,
    },
    hint: createStatusHint(probe.bridgeIsConnected, sessionSummary.bridgeIsConnected),
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      processId: session.processId,
      ...presentSessionKind(session.lane, session.sandboxId),
      buildStamp: session.buildStamp,
      revitVersion: session.revitVersion,
      openDocumentCount: session.openDocumentCount,
      activeDocumentTitle: session.activeDocumentTitle,
    })),
  };
}

function createStatusHint(
  bridgeIsConnected: boolean,
  sessionIsConnected: boolean,
): string | undefined {
  if (!bridgeIsConnected)
    return "Revit bridge is down: no Revit process is connected to this host. Read pe_logs target=host for the disconnect cause; Revit ops and scripts will fail until a Revit session with the Pe add-in connects.";
  if (!sessionIsConnected)
    return "Bridge path is up but no Revit session is active. Read pe_logs for the last session events before retrying Revit ops.";
  return undefined;
}

export const peLogs = createTool({
  id: "pe_logs",
  description:
    "Read bounded host and/or Revit log tails after status or execution indicates a host/Revit failure.",
  inputSchema: z.object({
    target: z
      .enum(["host", "revit", "all"])
      .default("all")
      .describe("Which log to tail: host = TS host process, revit = Revit add-in, all = both."),
    tailLineCount: z
      .number()
      .min(1)
      .max(1000)
      .default(200)
      .describe("Lines to read from the end of each log."),
  }),
  execute: async (input) =>
    createCurrentHostRpcCaller().call("logs.tail", {
      target: parseHostLogTarget(input.target ?? "all"),
      tailLineCount: input.tailLineCount ?? 200,
    }),
});

export const hostOperationSearch = createTool({
  id: "host_operation_search",
  description:
    "Discover host operations by capability. Start with projection=capability-map for broad orientation, then projection=matches (default) to rank candidates for a task; verbosity=hints adds examples and call guidance. Host admin status/logs are excluded here — use pe_status and pe_logs for those. Scripting is not in the catalog either — use the script_execute tool.",
  inputSchema: hostOperationSearchInputSchema,
  execute: async (input) => new HostRpcCaller().searchOperations(input),
});

export const hostOperationCall = createTool({
  id: "host_operation_call",
  description:
    "Call a generated user-facing host operation by key with a JSON request object. Omit request for NoRequest operations. Compact successes return the response plus request timing; hints/full add metadata. Revit bridge calls may require an active document, requests/responses are validated by generated schemas, expensive/mutating calls should stay bounded, and failures include targeted next steps.",
  inputSchema: z.object({
    key: z
      .string()
      .describe(
        "Operation key returned by host_operation_search, such as revit.context.summary, revit.resolve.references, or revit.catalog.loaded-families.",
      ),
    request: z
      .unknown()
      .optional()
      .describe(
        "JSON request object matching the generated operation request shape. Omit for NoRequest operations.",
      ),
    verbosity: toolVerbositySchema
      .default("compact")
      .describe(
        "Successful-call metadata size. Compact omits operation metadata; hints/full include increasingly verbose metadata. Failures always include full metadata.",
      ),
    timeoutSeconds: z
      .number()
      .min(5)
      .max(900)
      .default(300)
      .describe("Client-side timeout for this host call, in seconds."),
    bridgeSessionId: bridgeSessionIdSchema,
  }),
  execute: async (input, context) => {
    const hostRpcCaller = createCurrentHostRpcCaller(
      input.bridgeSessionId,
      input.timeoutSeconds * 1000,
    );
    const operation = await hostRpcCaller.getOperation(input.key);
    assertHostOperationCallAccess(operation, input.key, context);
    return hostRpcCaller.callOperation(input.key, coerceJsonObject(input.request), input.verbosity);
  },
});

export const scriptExecute = createTool({
  id: "script_execute",
  description:
    "Execute trusted in-process C# through the Revit scripting contract. Pass scriptContent for an inline snippet (prefer Execute-body statements like WriteLine(...); a full PeScriptContainer class is also allowed) OR sourcePath for a pod entrypoint declared in the workspace's pod.json — not both. Defaults to ReadOnly: active-document changes are rolled back. Use WriteTransaction for document edits, or NoTransaction only for APIs such as Document.SaveAs that reject an open transaction and need no rollback guard. Use Result(...) for structured JSON; check ct / ThrowIfCancelled() in loops so the cooperative timeout can interrupt them. This tool never builds, converges, or restarts Revit; inspect pe_status and run SDK convergence explicitly when freshness is required.",
  inputSchema: scriptExecuteInputSchema,
  execute: async (input) => {
    try {
      return await createCurrentScriptingTools(
        input.bridgeSessionId,
        scriptClientTimeoutMs(input.timeoutSeconds),
      ).execute(input);
    } catch (error) {
      // Mastra derives the tool_result isError flag from the returned object; a bare throw
      // surfaces to the agent as a "successful" result carrying an error string.
      return { isError: true, content: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const scriptBootstrap = createTool({
  id: "script_bootstrap",
  description:
    "Create or update a Pe.Revit scripting pod workspace through the host: pod.json, project file, docs, and a sample entrypoint. Preserves user-authored files and writes only host-owned workspace files.",
  inputSchema: scriptBootstrapInputSchema,
  outputSchema: scriptWorkspaceBootstrapDataSchema,
  execute: async (input, _context) => {
    const result = await createCurrentScriptingTools(input.bridgeSessionId).bootstrap(input);
    // Wire fields are optional-typed (NullValueHandling.Ignore); the bootstrap op
    // always returns the full shape, so assert it for the tool's output schema.
    return {
      ...result,
      generatedFiles: [...(result.generatedFiles ?? [])],
    } as typeof result & { generatedFiles: string[] } as never;
  },
});

export const captureView = createCaptureViewTool((bridgeSessionId) =>
  createCurrentHostRpcCaller(bridgeSessionId),
);

// Dedicated control-plane tool (pe_status class); sandbox lifecycle is fleet management and
// never appears in host_operation_search.
export const peSandbox = createPeSandboxTool(() =>
  resolveHostBaseUrl(peaProductToolContext.hostBaseUrl),
);

export const peaProductTools = {
  [peStatus.id]: peStatus,
  [peLogs.id]: peLogs,
  [peSandbox.id]: peSandbox,
  [hostOperationSearch.id]: hostOperationSearch,
  [hostOperationCall.id]: hostOperationCall,
  [requestAccess.id]: requestAccess,
  [readImage.id]: readImage,
  [captureView.id]: captureView,
  [revitApiSearch.id]: revitApiSearch,
  [revitApiFetch.id]: revitApiFetch,
  [scriptBootstrap.id]: scriptBootstrap,
  [scriptExecute.id]: scriptExecute,
  ...routeStateTools,
};

export const peaTools = peaProductTools;

export const peaProductToolProfile = createRuntimeToolProfile({
  id: "pea-product",
  tools: peaProductTools,
  catalog: peaProductToolCatalog,
  commands: {
    createSubCommands: (options?: PeaCliCommandOptions) => new PeaCliCommands(options).commands(),
  },
});

function createCurrentHostRpcCaller(bridgeSessionId?: string, timeoutMs?: number) {
  return new HostRpcCaller({
    hostBaseUrl: resolveHostBaseUrl(peaProductToolContext.hostBaseUrl),
    bridgeSessionId,
    timeoutMs,
  });
}

function createCurrentScriptingTools(bridgeSessionId?: string, timeoutMs?: number) {
  return new ScriptingTools(createCurrentHostRpcCaller(bridgeSessionId, timeoutMs), {
    workspaceKey: resolveWorkspaceKey(peaProductToolContext.workspaceKey),
  });
}

function summarizeActiveDocument(activeDocument: ActiveDocumentSummary) {
  return {
    title: activeDocument.title,
    key: activeDocument.key,
    path: activeDocument.path,
    identityKind: activeDocument.isModelInCloud
      ? "cloud"
      : activeDocument.path
        ? "path"
        : "unsaved",
    isFamilyDocument: activeDocument.isFamilyDocument,
    isWorkshared: activeDocument.isWorkshared,
    isModelInCloud: activeDocument.isModelInCloud,
    cloudProjectGuid: activeDocument.cloudProjectGuid,
    cloudModelGuid: activeDocument.cloudModelGuid,
    cloudModelUrn: activeDocument.cloudModelUrn,
    observedAtUnixMs: activeDocument.observedAtUnixMs,
  };
}

function parseHostLogTarget(target: "host" | "revit" | "all"): HostLogTarget {
  switch (target) {
    case "host":
      return HostLogTarget.Host;
    case "revit":
      return HostLogTarget.Revit;
    case "all":
      return HostLogTarget.All;
  }
}

type HostOperationLookupResult = Awaited<ReturnType<HostRpcCaller["getOperation"]>>;

function assertHostOperationCallAccess(
  operation: HostOperationLookupResult,
  operationKey: string,
  toolContext: unknown,
): void {
  if (operation?.intent !== "Mutate") return;

  assertRuntimeToolAccess({
    toolName: `host_operation_call:${operationKey}`,
    metadata: {
      name: `host_operation_call:${operationKey}`,
      title: operation.displayName ?? operationKey,
      kind: "edit",
    },
    accessLevel: readRuntimeAccessLevelFromToolContext(toolContext),
  });
}
