import { createTool } from "@mastra/core/tools";
import z from "zod";
import {
  assertRuntimeToolAccess,
  createRuntimeToolProfile,
  readRuntimeAccessLevelFromToolContext,
} from "@pe/runtime";
import { HostLogTarget, type HostOpResponse } from "@pe/host-contracts/operation-types";
import { HostRpcCaller } from "../shared/host-rpc-caller.js";

type ActiveDocumentSummary = NonNullable<
  HostOpResponse<"bridge.sessions.summary">["activeDocument"]
>;
import {
  ScriptingTools,
  scriptBootstrapInputSchema,
  scriptExecuteInputSchema,
  scriptPodExportInputSchema,
  scriptPodImportInputSchema,
} from "../shared/scripting.ts";
import { readImage } from "../shared/read-image.ts";
import { requestAccess } from "../shared/request-access.ts";
import { resolveHostBaseUrl, resolveWorkspaceKey } from "../shared/host-config.ts";
import { peaProductToolCatalog } from "../tool-metadata.ts";
import { PeaCliCommands, type PeaCliCommandOptions } from "./PeaCliCommands.ts";
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

export const defaultPeaAgentModelId = "openai/gpt-5.4";

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
    "Optional target selector for a connected Revit session: 'rrd' (the Rider dev session — it holds the user's live docs), 'sandbox:<id>', a pid, or a raw session id. With one session connected it may be omitted; with several, untargeted Revit operations hard-fail with the session listing.",
  );

const hostOperationSearchInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe("Natural-language or keyword query describing the capability you need."),
  domain: z
    .string()
    .optional()
    .describe("Optional exact top-level domain filter, such as revit, settings, or scripting."),
  intent: z.enum(["Read", "Mutate"]).optional(),
  requiresActiveDocument: z.boolean().optional(),
  limit: z.number().min(1).max(50).default(8),
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
  sampleScriptPath: z.string(),
  revitVersion: z.string(),
  targetFramework: z.string(),
  runtimeAssemblyPath: z.string(),
  generatedFiles: z.array(z.string()),
});

export const peStatus = createTool({
  id: "pe_status",
  description:
    "Read fresh host status: host, bridge/session, active document, workspace, and log-location facts. Use compact for orientation and full for the raw probe/session DTOs.",
  inputSchema: z.object({
    verbosity: z.enum(["compact", "full"]).default("compact"),
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
        lane: sessionSummary.lane,
        sandboxId: sessionSummary.sandboxId,
        buildStamp: sessionSummary.buildStamp,
        revitVersion: sessionSummary.revitVersion,
        openDocumentCount: sessionSummary.openDocumentCount,
        activeDocument:
          sessionSummary.activeDocument == null
            ? undefined
            : summarizeActiveDocument(sessionSummary.activeDocument),
        availableModuleCount: sessionSummary.availableModules.length,
      },
      sessions: sessionsList.sessions.map((session) => ({
        sessionId: session.sessionId,
        processId: session.processId,
        lane: session.lane,
        sandboxId: session.sandboxId,
        buildStamp: session.buildStamp,
        revitVersion: session.revitVersion,
        openDocumentCount: session.openDocumentCount,
        activeDocumentTitle: session.activeDocumentTitle,
      })),
    };
  },
});

export const peLogs = createTool({
  id: "pe_logs",
  description:
    "Read bounded host and/or Revit log tails after status or execution indicates a host/Revit failure.",
  inputSchema: z.object({
    target: z.enum(["host", "revit", "all"]).default("all"),
    tailLineCount: z.number().min(1).max(1000).default(200),
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
    "Search generated user-facing host operations by capability and filters. Use projection=capability-map for broad orientation, compact matches for discovery, hints for examples/call guidance, and full for metadata plus request/response shapes. Direct host admin calls such as status, sessions, and logs use dedicated tools instead of this search surface.",
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
    return hostRpcCaller.callOperation(input.key, input.request, input.verbosity);
  },
});

export const scriptExecute = createTool({
  id: "script_execute",
  description:
    "Execute a C# Revit script through the host scripting contract. For InlineSnippet, prefer Execute-body statements like WriteLine(...); a full PeScriptContainer class with public override void Execute() is also allowed. Use workspace .cs files for durable work. Loose workspaces compile only the requested file; pod.json workspaces compile all src and require a declared entrypoint.",
  inputSchema: scriptExecuteInputSchema,
  execute: async (input) => {
    try {
      return await createCurrentScriptingTools(input.bridgeSessionId).execute(input);
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
    "Create or update a Pe.Revit scripting workspace through the host and return host-owned paths/references. Preserves user-authored files and writes only host-owned workspace files.",
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

export const scriptPodImport = createTool({
  id: "script_pod_import",
  description:
    "Import a pod.json-backed Revit scripting workspace from a conservative zip archive. Import hard-fails if the target workspace slug already exists.",
  inputSchema: scriptPodImportInputSchema,
  execute: async (input) => createCurrentScriptingTools(input.bridgeSessionId).importPod(input),
});

export const scriptPodExport = createTool({
  id: "script_pod_export",
  description:
    "Export an existing pod.json-backed Revit scripting workspace as a portable source-first zip archive. Generated/runtime folders and DLL payloads are excluded.",
  inputSchema: scriptPodExportInputSchema,
  execute: async (input) => createCurrentScriptingTools(input.bridgeSessionId).exportPod(input),
});

export const peaProductTools = {
  [peStatus.id]: peStatus,
  [peLogs.id]: peLogs,
  [hostOperationSearch.id]: hostOperationSearch,
  [hostOperationCall.id]: hostOperationCall,
  [requestAccess.id]: requestAccess,
  [readImage.id]: readImage,
  [scriptBootstrap.id]: scriptBootstrap,
  [scriptExecute.id]: scriptExecute,
  [scriptPodImport.id]: scriptPodImport,
  [scriptPodExport.id]: scriptPodExport,
  // [revitApiSearch.id]: revitApiSearch,
  // [revitApiFetch.id]: revitApiFetch,
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

function createCurrentScriptingTools(bridgeSessionId?: string) {
  return new ScriptingTools(createCurrentHostRpcCaller(bridgeSessionId), {
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
