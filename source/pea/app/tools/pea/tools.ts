import { createTool } from "@mastra/core/tools";
import z from "zod";
import {
  createPeHostClient,
  resolveHostBaseUrl,
  resolveWorkspaceKey,
} from "../../pe-host.js";
import {
  defaultRevitApiDocsYear,
  defaultRevitApiMaxResults,
  toolInputArgSchemas,
  toolOutputSchemas,
} from "../../types.js";
import { HostLogTarget } from "../../host-client.js";
import { extractRvtDocsText } from "../../lib/extractDocs.js";
import { searchWrapper } from "../../lib/searchDocs.js";
import {
  callHostOperation,
  searchHostOperations,
} from "../../host-operation-runtime.js";
import {
  bootstrapScriptWorkspace,
  executeScriptViaHost,
  scriptBootstrapInputSchema,
  scriptExecuteInputSchema,
} from "../shared/scripting.js";

interface PeaProductToolContext {
  hostBaseUrl?: string;
  workspaceKey?: string;
}

let peaProductToolContext: PeaProductToolContext = {};

export function configurePeaProductToolContext(
  context: PeaProductToolContext,
): void {
  peaProductToolContext = {
    hostBaseUrl: firstNonBlank(context.hostBaseUrl),
    workspaceKey: firstNonBlank(context.workspaceKey),
  };
}

const revitApiQueryInputSchema = z.object({
  queryString: toolInputArgSchemas.queryString,
  queryTypes: toolInputArgSchemas.queryTypes,
  year: toolInputArgSchemas.year,
  maxResults: toolInputArgSchemas.maxResults,
  extractFirstResult: toolInputArgSchemas.extractFirstResult,
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
    createCurrentHostClient().host.getLogs({
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
    timeoutSeconds: z
      .number()
      .min(5)
      .max(900)
      .default(300)
      .describe("Client-side timeout for this host call, in seconds."),
  }),
  execute: async (input) =>
    callHostOperation(
      {
        baseUrl: currentHostBaseUrl(),
        timeoutMs: (input.timeoutSeconds ?? 300) * 1000,
      },
      input.key,
      input.request,
      input.verbosity,
    ),
});

export const scriptExecute = createTool({
  id: "script_execute",
  description:
    "Execute a C# Revit script through the Pe.Host scripting contract. Use inline scriptContent for tiny probes and workspace .cs files for durable or multi-step work. Call script_bootstrap when paths or references are unknown.",
  inputSchema: scriptExecuteInputSchema,
  execute: async (input) =>
    executeScriptViaHost(input, {
      hostBaseUrl: currentHostBaseUrl(),
      workspaceKey: currentWorkspaceKey(),
    }),
});

export const scriptBootstrap = createTool({
  id: "script_bootstrap",
  description:
    "Create or update a Pe.Revit scripting workspace through Pe.Host and return host-owned paths/references. Preserves user-authored files and writes only Pe.Host-owned workspace files.",
  inputSchema: scriptBootstrapInputSchema,
  outputSchema: toolOutputSchemas.scriptWorkspaceBootstrapDataSchema,
  execute: async (input) =>
    bootstrapScriptWorkspace(input, {
      hostBaseUrl: currentHostBaseUrl(),
      workspaceKey: currentWorkspaceKey(),
    }),
});

export const revitApiSearch = createTool({
  id: "revit_api_docs_search",
  description:
    "Search Revit API documentation for exact API entities, signatures, members, and remarks. Set extractFirstResult to include extractedText on the first result only. Use live host operations or scripts for current model/session/document state.",
  inputSchema: revitApiQueryInputSchema,
  outputSchema: toolOutputSchemas.searchResultsSchema,
  execute: async (input) => {
    const {
      queryString,
      queryTypes,
      year = defaultRevitApiDocsYear,
      maxResults = defaultRevitApiMaxResults,
      extractFirstResult = false,
    } = input;
    const results = await searchWrapper(
      queryString,
      year,
      maxResults,
      queryTypes,
    );
    if (!extractFirstResult || results.length === 0) return results;

    const [firstResult, ...remainingResults] = results;
    const extractedText = await extractRvtDocsText(
      rvtDocsUrlFromSlug(firstResult.url),
    );
    return [{ ...firstResult, extractedText }, ...remainingResults];
  },
});

export const revitApiFetch = createTool({
  id: "revit_api_docs_fetch",
  description:
    "Fetch one Revit API documentation page by rvtdocs URL slug returned from revit_api_search. Use it for signatures/members/remarks after narrowing to a specific API entity, not for live document facts.",
  inputSchema: z.object({
    urlSlug: toolInputArgSchemas.urlSlug,
  }),
  outputSchema: toolOutputSchemas.docsTextSchema,
  execute: async (input) =>
    extractRvtDocsText(rvtDocsUrlFromSlug(input.urlSlug)),
});

export const peaProductTools = {
  [peStatus.id]: peStatus,
  [peLogs.id]: peLogs,
  [hostOperationSearch.id]: hostOperationSearch,
  [hostOperationCall.id]: hostOperationCall,
  [scriptBootstrap.id]: scriptBootstrap,
  [scriptExecute.id]: scriptExecute,
  [revitApiSearch.id]: revitApiSearch,
  [revitApiFetch.id]: revitApiFetch,
};

export const peaTools = peaProductTools;

function rvtDocsUrlFromSlug(urlSlug: string): string {
  if (/^https?:\/\//i.test(urlSlug)) return urlSlug;

  return urlSlug.startsWith("/")
    ? `https://rvtdocs.com${urlSlug}`
    : `https://rvtdocs.com/${urlSlug}`;
}

function createCurrentHostClient() {
  return createPeHostClient(peaProductToolContext.hostBaseUrl);
}

function currentHostBaseUrl(): string {
  return resolveHostBaseUrl(peaProductToolContext.hostBaseUrl);
}

function currentWorkspaceKey(): string {
  return resolveWorkspaceKey(peaProductToolContext.workspaceKey);
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

function firstNonBlank(
  ...values: Array<string | undefined>
): string | undefined {
  return values
    .find((value) => value != null && value.trim().length > 0)
    ?.trim();
}
