import { createTool } from "@mastra/core/tools";
import z from "zod";
import {
  createPeHostClient,
  resolveHostBaseUrl,
  resolveWorkspaceKey,
} from "./pe-host.js";
import {
  defaultRevitApiDocsYear,
  defaultRevitApiMaxResults,
  toolInputArgSchemas,
  toolOutputSchemas,
} from "./types.js";
import { HostLogTarget, ScriptExecutionSourceKind, ScriptPermissionMode } from "./host-client.js";
import { extractRvtDocsText } from "./lib/extractDocs.js";
import { searchWrapper } from "./lib/searchDocs.js";
import {
  callHostOperation,
  searchHostOperations,
} from "./host-operation-runtime.js";

const hostClient = createPeHostClient();

const revitApiQueryInputSchema = z.object({
  queryString: toolInputArgSchemas.queryString,
  queryTypes: toolInputArgSchemas.queryTypes,
  year: toolInputArgSchemas.year,
  maxResults: toolInputArgSchemas.maxResults,
});

const toolVerbositySchema = z.enum(["compact", "hints", "full"]);

const hostOperationSearchInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Natural-language or keyword query describing the capability you need.",
    ),
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
      "Output size. Use compact by default; use hints for examples/expansion hints; use full only when you need route and full request/response shapes.",
    ),
});

export const peStatus = createTool({
  id: "pe_status",
  description:
    "Read fresh Pe.Host status: host, bridge/session, active document, workspace, and log-location facts. Use compact for orientation and full for the raw probe/session DTOs.",
  inputSchema: z.object({
    verbosity: z.enum(["compact", "full"]).default("compact"),
  }),
  execute: async (input) => {
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
            : {
                title: sessionSummary.activeDocument.title,
                key: sessionSummary.activeDocument.key,
                isFamilyDocument:
                  sessionSummary.activeDocument.isFamilyDocument,
                isWorkshared: sessionSummary.activeDocument.isWorkshared,
                isModelInCloud: sessionSummary.activeDocument.isModelInCloud,
              },
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
    hostClient.host.getLogs({
      target: parseHostLogTarget(input.target ?? "all"),
      tailLineCount: input.tailLineCount ?? 200,
    }),
});

export const hostOperationSearch = createTool({
  id: "host_operation_search",
  description:
    "Search generated public Pe.Host operations by capability and filters. Use compact for discovery, hints for examples, and full for routes plus request/response shapes.",
  inputSchema: hostOperationSearchInputSchema,
  execute: async (input) => searchHostOperations(input),
});

export const hostOperationCall = createTool({
  id: "host_operation_call",
  description:
    "Call a generated public Pe.Host operation by key with a JSON request object. Omit request for NoRequest operations. Compact successes return the response plus request timing; hints/full add metadata. Failures include operation metadata and suggested next steps. Bridge-backed operations are serialized when metadata assigns a single-flight group.",
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
    timeoutSeconds: z.number().min(5).max(900).default(300).describe(
      "Client-side timeout for this host call, in seconds.",
    ),
  }),
  execute: async (input) =>
    callHostOperation(
      { baseUrl: resolveHostBaseUrl(), timeoutMs: (input.timeoutSeconds ?? 300) * 1000 },
      input.key,
      input.request,
      input.verbosity,
    ),
});

export const scriptExecute = createTool({
  id: "script_execute",
  description:
    "Execute a C# Revit script through the Pe.Host scripting contract. Use inline scriptContent for tiny probes and workspace .cs files for durable or multi-step work. Call script_bootstrap when paths or references are unknown.",
  inputSchema: z.object({
    scriptContent: z.string().optional(),
    sourceKind: z
      .enum(["InlineSnippet", "WorkspacePath"])
      .default("InlineSnippet"),
    sourcePath: z.string().optional(),
    workspaceKey: z.string().default(resolveWorkspaceKey()),
    sourceName: z.string().default("AgentSnippet.cs"),
    permissionMode: z
      .enum(["ReadOnly", "WriteTransaction"])
      .default("ReadOnly")
      .describe("Defaults to ReadOnly. Use WriteTransaction only for explicit mutations; the host owns the transaction."),
  }),
  execute: async (input) =>
    hostClient.scripting.execute({
      scriptContent: input.scriptContent,
      sourceKind:
        input.sourceKind === "WorkspacePath"
          ? ScriptExecutionSourceKind.WorkspacePath
          : ScriptExecutionSourceKind.InlineSnippet,
      sourcePath: input.sourcePath,
      workspaceKey: input.workspaceKey ?? resolveWorkspaceKey(),
      sourceName: input.sourceName,
      permissionMode:
        input.permissionMode === "WriteTransaction"
          ? ScriptPermissionMode.WriteTransaction
          : ScriptPermissionMode.ReadOnly,
    }),
});

export const scriptBootstrap = createTool({
  id: "script_bootstrap",
  description:
    "Create or update a Pe.Revit scripting workspace through Pe.Host and return host-owned paths/references. Preserves user-authored files and writes only Pe.Host-owned workspace files.",
  inputSchema: z.object({
    workspaceKey: z.string().default(resolveWorkspaceKey()),
    createSampleScript: z
      .boolean()
      .default(true)
      .describe(
        "Create the sample script file when it does not already exist.",
      ),
  }),
  outputSchema: toolOutputSchemas.scriptWorkspaceBootstrapDataSchema,
  execute: async (input) =>
    hostClient.scripting.bootstrapWorkspace({
      workspaceKey: input.workspaceKey ?? resolveWorkspaceKey(),
      createSampleScript: input.createSampleScript ?? true,
    }),
});

export const revitApiSearch = createTool({
  id: "revit_api_search",
  description:
    "Search Revit API documentation for exact API entities, signatures, members, and remarks. Use live host operations or scripts for current model/session/document state.",
  inputSchema: revitApiQueryInputSchema,
  outputSchema: toolOutputSchemas.searchResultsSchema,
  execute: async (input) => {
    const {
      queryString,
      queryTypes,
      year = defaultRevitApiDocsYear,
      maxResults = defaultRevitApiMaxResults,
    } = input;
    return await searchWrapper(queryString, year, maxResults, queryTypes);
  },
});

export const revitApiFetch = createTool({
  id: "revit_api_fetch",
  description:
    "Fetch one Revit API documentation page by rvtdocs URL slug returned from revit_api_search. Use it for signatures/members/remarks after narrowing to a specific API entity, not for live document facts.",
  inputSchema: z.object({
    urlSlug: toolInputArgSchemas.urlSlug,
  }),
  outputSchema: toolOutputSchemas.docsTextSchema,
  execute: async (input) => {
    const fullUrl = input.urlSlug.startsWith("/")
      ? `https://rvtdocs.com${input.urlSlug}`
      : `https://rvtdocs.com/${input.urlSlug}`;
    return await extractRvtDocsText(fullUrl);
  },
});

export const peaTools = {
  [peStatus.id]: peStatus,
  [peLogs.id]: peLogs,
  [hostOperationSearch.id]: hostOperationSearch,
  [hostOperationCall.id]: hostOperationCall,
  [scriptBootstrap.id]: scriptBootstrap,
  [scriptExecute.id]: scriptExecute,
  [revitApiSearch.id]: revitApiSearch,
  [revitApiFetch.id]: revitApiFetch,
};

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
