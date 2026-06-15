import { createTool } from "@mastra/core/tools";
import z from "zod";
import { createRuntimeToolProfile } from "@pe/runtime";
import { HostLogTarget } from "@pe/host-client";
import type { HostActiveDocumentSummary } from "@pe/host-client";
import { PeHostClient } from "@pe/host-client";
import {
  ScriptingTools,
  scriptBootstrapInputSchema,
  scriptExecuteInputSchema,
  scriptPodExportInputSchema,
  scriptPodImportInputSchema,
} from "../shared/scripting.ts";
import { requestAccess } from "../shared/request-access.ts";
import { peaProductToolCatalog } from "../tool-metadata.ts";
import { PeaCliCommands, type PeaCliCommandOptions } from "./PeaCliCommands.ts";
export { peaProductToolCatalog } from "../tool-metadata.ts";
export { PeaCliCommands } from "./PeaCliCommands.ts";
export {
  bundledPeaSkills,
  materializeBundledPeaSkills,
  peaSkillPaths,
  peaStandardSkillsRoot,
} from "./skills.ts";

interface PeaProductToolContext {
  hostBaseUrl?: string;
  workspaceKey?: string;
}

let peaProductToolContext: PeaProductToolContext = {};

export function configurePeaProductToolContext(context: PeaProductToolContext): void {
  peaProductToolContext = {
    hostBaseUrl: firstNonBlank(context.hostBaseUrl),
    workspaceKey: firstNonBlank(context.workspaceKey),
  };
}

const toolVerbositySchema = z.enum(["compact", "hints", "full"]);

const hostOperationSearchInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe("Natural-language or keyword query describing the capability you need."),
  domain: z
    .string()
    .optional()
    .describe(
      "Optional exact top-level domain filter, such as revit, host, settings, script, or aps.",
    ),
  executionMode: z.enum(["Local", "Bridge"]).optional(),
  intent: z.enum(["Read", "Mutate"]).optional(),
  requiresBridge: z.boolean().optional(),
  requiresActiveDocument: z.boolean().optional(),
  limit: z.number().min(1).max(50).default(8),
  verbosity: toolVerbositySchema
    .default("compact")
    .describe(
      "Output size for projection=matches. Use compact by default; use hints for examples/expansion hints; use full only when you need route and full request/response shapes.",
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
    "Read fresh Pe.Host status: host, bridge/session, active document, workspace, and log-location facts. Use compact for orientation and full for the raw probe/session DTOs.",
  inputSchema: z.object({
    verbosity: z.enum(["compact", "full"]).default("compact"),
  }),
  execute: async (input) => {
    const hostClient = createCurrentHostClient();
    const probe = await hostClient.host.getProbe();
    const sessionSummary = await hostClient.host.getSessionSummary();
    if (input.verbosity === "full") return { probe, sessionSummary };

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
        revitVersion: sessionSummary.revitVersion,
        openDocumentCount: sessionSummary.openDocumentCount,
        activeDocument:
          sessionSummary.activeDocument == null
            ? undefined
            : summarizeActiveDocument(sessionSummary.activeDocument),
        availableModuleCount: sessionSummary.availableModules.length,
      },
    };
  },
});

export const peLogs = createTool({
  id: "pe_logs",
  description:
    "Read bounded Pe.Host and/or Revit log tails after status or execution indicates a host/Revit failure.",
  inputSchema: z.object({
    target: z.enum(["host", "revit", "all"]).default("all"),
    tailLineCount: z.number().min(1).max(1000).default(200),
  }),
  execute: async (input) =>
    createCurrentHostClient().host.getLogs({
      target: parseHostLogTarget(input.target ?? "all"),
      tailLineCount: input.tailLineCount ?? 200,
    }),
});

export const hostOperationSearch = createTool({
  id: "host_operation_search",
  description:
    "Search generated public Pe.Host operations by capability and filters. Use projection=capability-map for broad orientation, compact matches for discovery, hints for examples/call guidance, and full for routes plus request/response shapes. Results are compact: operation keys carry taxonomy; generic bridge, active-document, validation, cost, and mutation safety are summarized rather than repeated as preflight prose.",
  inputSchema: hostOperationSearchInputSchema,
  execute: async (input) => new PeHostClient().general.searchOperations(input),
});

export const hostOperationCall = createTool({
  id: "host_operation_call",
  description:
    "Call a generated public Pe.Host operation by key with a JSON request object. Omit request for NoRequest operations. Compact successes return the response plus request timing; hints/full add metadata. Bridge-backed operations are serialized when metadata assigns a single-flight group; Revit bridge calls may require an active document, strict request validation rejects unknown/nonsensical fields, expensive/mutating calls should stay bounded, and failures include targeted next steps.",
  inputSchema: z.object({
    key: z
      .string()
      .describe(
        "Operation key returned by host_operation_search, such as revit.context.summary, revit.resolve.references, revit.catalog.loaded-families, or settings.document.validate.",
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
  }),
  execute: async (input) =>
    new PeHostClient().general.callOperation(input.key, input.request, input.verbosity),
});

export const scriptExecute = createTool({
  id: "script_execute",
  description:
    "Execute a C# Revit script through the Pe.Host scripting contract. For InlineSnippet, prefer Execute-body statements like WriteLine(...); a full PeScriptContainer class with public override void Execute() is also allowed. Use workspace .cs files for durable work. Loose workspaces compile only the requested file; pod.json workspaces compile all src and require a declared entrypoint.",
  inputSchema: scriptExecuteInputSchema,
  execute: async (input) => createCurrentScriptingTools().execute(input),
});

export const scriptBootstrap = createTool({
  id: "script_bootstrap",
  description:
    "Create or update a Pe.Revit scripting workspace through Pe.Host and return host-owned paths/references. Preserves user-authored files and writes only Pe.Host-owned workspace files.",
  inputSchema: scriptBootstrapInputSchema,
  outputSchema: scriptWorkspaceBootstrapDataSchema,
  execute: async (input) => createCurrentScriptingTools().bootstrap(input),
});

export const scriptPodImport = createTool({
  id: "script_pod_import",
  description:
    "Import a pod.json-backed Revit scripting workspace from a conservative zip archive. Import hard-fails if the target workspace slug already exists.",
  inputSchema: scriptPodImportInputSchema,
  execute: async (input) => createCurrentScriptingTools().importPod(input),
});

export const scriptPodExport = createTool({
  id: "script_pod_export",
  description:
    "Export an existing pod.json-backed Revit scripting workspace as a portable source-first zip archive. Generated/runtime folders and DLL payloads are excluded.",
  inputSchema: scriptPodExportInputSchema,
  execute: async (input) => createCurrentScriptingTools().exportPod(input),
});

export const peaProductTools = {
  [peStatus.id]: peStatus,
  [peLogs.id]: peLogs,
  [hostOperationSearch.id]: hostOperationSearch,
  [hostOperationCall.id]: hostOperationCall,
  [requestAccess.id]: requestAccess,
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

function createCurrentHostClient() {
  return new PeHostClient({
    baseUrl: PeHostClient.resolveHostBaseUrl(peaProductToolContext.hostBaseUrl),
  });
}

function createCurrentScriptingTools() {
  return new ScriptingTools(createCurrentHostClient(), {
    workspaceKey: PeHostClient.resolveWorkspaceKey(peaProductToolContext.workspaceKey),
  });
}

function summarizeActiveDocument(activeDocument: HostActiveDocumentSummary) {
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

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value.trim().length > 0)?.trim();
}
