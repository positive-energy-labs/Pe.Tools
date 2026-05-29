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
import { HostLogTarget, ScriptExecutionSourceKind } from "./host-client.js";
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
      "Natural-language or keyword query, such as this view, selected equipment, loaded families, schedule rows, printed sheets, parameter presence, settings validate, or electrical panels.",
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
    "Read explicit fresh Pe.Host status. Automatic per-turn checks only detect meaningful status changes; use pe_status when you need current host, bridge, session, active-document, workspace, or log-location facts. Defaults to compact orientation: bridge health, contract versions, active document, open-doc count, and module count. Use verbosity=full only when you need the full probe/session DTO.",
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
    "Search generated public Pe.Host operations by capability, top-level family/domain, mutability, bridge requirement, and active-document requirement. Defaults to compact cards so search stays cheap. Use verbosity=hints for request examples and bounded-expansion guidance; use verbosity=full only when composing an unfamiliar request and needing full shapes/routes. Revit context operations like revit.context.summary and revit.context.visible-summary provide semantic Revit context, not host/session status.",
  inputSchema: hostOperationSearchInputSchema,
  execute: async (input) => searchHostOperations(input),
});

export const hostOperationCall = createTool({
  id: "host_operation_call",
  description:
    "Call a generated public Pe.Host operation by key with a JSON request object. Use revit.context.summary for fresh current Revit user context such as active view/sheet, selection, browser counts, and compact visible-category context; automatic status checks do not call bridge-backed Revit context operations. Successful calls default to { ok, key, response } without repeating operation metadata. Use verbosity=hints/full only when metadata is needed in the response. Prefer compact revit.context/catalog/resolve operations before expensive revit.matrix/detail calls, and do not run bridge-backed operations in parallel when metadata shows singleFlightGroup=revit. Omit request for NoRequest operations. Failures include operation metadata and suggested next steps.",
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
  }),
  execute: async (input) =>
    callHostOperation(
      { baseUrl: resolveHostBaseUrl() },
      input.key,
      input.request,
      input.verbosity,
    ),
});

export const scriptExecute = createTool({
  id: "script_execute",
  description:
    "Execute a C# Revit script through the Pe.Host scripting contract. Prefer host_operation_search/host_operation_call first. Use inline scriptContent only for tiny probes; for non-trivial work, write a workspace .cs file, call script_bootstrap first if paths/references are unknown, then execute with sourceKind=WorkspacePath.",
  inputSchema: z.object({
    scriptContent: z.string().optional(),
    sourceKind: z
      .enum(["InlineSnippet", "WorkspacePath"])
      .default("InlineSnippet"),
    sourcePath: z.string().optional(),
    workspaceKey: z.string().default(resolveWorkspaceKey()),
    sourceName: z.string().default("AgentSnippet.cs"),
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
    }),
});

export const scriptBootstrap = createTool({
  id: "script_bootstrap",
  description:
    "Create or update a Pe.Revit scripting workspace through Pe.Host and return host-owned paths/references. Use this before authoring workspace C# scripts or when script diagnostics indicate missing generated references. This preserves user-authored files and writes only Pe.Host-owned workspace files.",
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
    "Search Revit API documentation for exact API entities. Query formats should look like `FilteredElementCollector`, `Element.LookupParameter`, or `FamilyCreate.NewExtrusion(bool, CurveArrArray, SketchPlane, double)`. For questions about the current model/session/document state, use pe_status, host_operation_search/host_operation_call, or scripts instead of docs search.",
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
