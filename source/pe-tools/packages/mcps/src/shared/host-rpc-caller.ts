import { Effect } from "effect";
import {
  hostProcessIdentity,
  type HostOperationCostTier,
  type HostOperationDefinition,
  type HostOperationIntent,
  type HostOperationRequestExample,
  type HostOperationVisibility,
} from "@pe/host-contracts/contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HostCallError,
  type OpKey,
  type OpRequestOf,
  type OpResponseOf,
  type HostSessionScope,
} from "@pe/host-contracts/operation-types";

type HostRpcCallerOptions = HostSessionScope & {
  hostBaseUrl?: string;
  timeoutMs?: number;
  /** Test seam: skip the live /ops fetch and use this catalog. */
  catalogOverride?: readonly HostOperationDefinition[];
};

// --- runtime op catalog ---------------------------------------------------------
// The connected session's GET /ops is the only catalog; there is no compiled-in
// metadata. Cached briefly so capability maps and per-call enrichment don't hit
// the bridge repeatedly.

type OpsCatalogEntry = HostOperationDefinition & {
  requestSchemaJson?: string;
  responseSchemaJson?: string;
};

/** Ops already exposed through dedicated MCP tools (pe_status, pe_logs). */
const dedicatedToolOperationKeys = new Set([
  "host.status",
  "logs.tail",
  "bridge.sessions.list",
  "bridge.sessions.summary",
]);

/**
 * Control-plane keys hidden from the catalog projection (search and capability
 * map), exactly like the dedicated-tool admin ops above. scripting.* remains a
 * bridge op at the transport level (POST /call, host_operation_call) — the
 * script_execute tool is the one scripting door; the catalog is purely the
 * document-world data plane.
 */
function isHiddenFromCatalogProjection(key: string): boolean {
  return dedicatedToolOperationKeys.has(key) || key.startsWith("scripting.");
}

const CATALOG_TTL_MS = 30_000;
const catalogCache = new Map<string, { at: number; ops: HostOperationDefinition[] }>();

function schemaTitle(schemaJson: string | undefined): string | undefined {
  if (!schemaJson) return undefined;
  try {
    const parsed = JSON.parse(schemaJson) as { title?: unknown };
    return typeof parsed.title === "string" ? parsed.title : undefined;
  } catch {
    return undefined;
  }
}

async function loadCatalog(
  hostBaseUrl: string,
  bridgeSessionId?: string,
): Promise<HostOperationDefinition[]> {
  const base = trimTrailingSlash(hostBaseUrl);
  // A catalog describes one Revit process. Sharing it across selectors can make Pea discover an
  // operation in RRD and then invoke it in a sandbox where that contract does not exist.
  const cacheKey = `${base}\0${bridgeSessionId ?? ""}`;
  const cached = catalogCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.ops;

  const headers: Record<string, string> = {};
  if (bridgeSessionId) headers[HOST_RPC_BRIDGE_SESSION_HEADER] = bridgeSessionId;
  const response = await fetch(`${base}/ops`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new HostCallError(
      `host.ops.catalog: GET ${base}/ops failed with ${response.status}`,
      response.status,
      { operationKey: "host.ops.catalog", status: response.status },
    );
  }
  const payload = (await response.json()) as { operations?: OpsCatalogEntry[] };
  const ops = (payload.operations ?? []).map((entry) => ({
    ...entry,
    requestTypeName: entry.requestTypeName ?? schemaTitle(entry.requestSchemaJson),
    responseTypeName: entry.responseTypeName ?? schemaTitle(entry.responseSchemaJson),
  }));
  catalogCache.set(cacheKey, { at: Date.now(), ops });
  return ops;
}

type HostOperationVerbosity = "compact" | "hints" | "full";
type RevitOperationLayer = "Context" | "Catalog" | "Matrix" | "Detail" | "Resolve" | "Apply";

type HostCapabilityMapRow = {
  key: string;
  description: string;
  safety: string;
  inputKind: string;
  outputKind: string;
  terms: string;
};

type HostCapabilityMapSection = {
  id: string;
  title: string;
  summary: string;
  rows: readonly HostCapabilityMapRow[];
};

type HostOperationSearchOptions = {
  query?: string;
  domain?: string;
  intent?: HostOperationIntent;
  requiresActiveDocument?: boolean;
  limit?: number;
  verbosity?: HostOperationVerbosity;
  visibility?: HostOperationVisibility;
  projection?: "matches" | "capability-map";
  capabilityMapFormat?: "markdown" | "json" | "toon";
};

type HostOperationSearchResult = {
  key: string;
  displayName: string;
  description: string;
  safety: string;
  costTier?: HostOperationCostTier;
  visibility?: HostOperationVisibility;
  safeDefaultRequestJson?: string | null;
  requestTypeName: string;
  responseTypeName: string;
  requestHint: string;
  bestRequestExample?: HostOperationRequestExample;
  usageHint: string;
  searchTerms?: readonly string[];
  requiresActiveDocument?: boolean;
};

type HostOperationCallResult =
  | {
      ok: true;
      key: string;
      elapsedMs: number;
      operation?: HostOperationSearchResult;
      response: unknown;
    }
  | {
      ok: false;
      key: string;
      elapsedMs: number;
      operation?: HostOperationSearchResult;
      status?: number;
      message: string;
      problem?: unknown;
      bestRequestExample?: HostOperationRequestExample;
      nextSteps: readonly string[];
    };

export class HostRpcCaller {
  private readonly options: Required<Pick<HostRpcCallerOptions, "hostBaseUrl">> &
    HostRpcCallerOptions;

  constructor(options: HostRpcCallerOptions = {}) {
    this.options = {
      ...options,
      hostBaseUrl: options.hostBaseUrl ?? hostProcessIdentity.defaultHostBaseUrl,
    };
  }

  call<K extends OpKey>(key: K, request?: OpRequestOf<K>): Promise<OpResponseOf<K>> {
    return Effect.runPromise(
      callHostRpcEffect(key, request, this.options).pipe(
        Effect.map(({ rawBody }) => rawBody as OpResponseOf<K>),
      ),
    );
  }

  /** Enrichment lookup against the live catalog; undefined when the catalog is unreachable. */
  async getOperation(key: string): Promise<HostOperationDefinition | undefined> {
    const operations = await this.catalog().catch(() => [] as HostOperationDefinition[]);
    return operations.find((operation) => operation.key === key);
  }

  /** Search/capability-map over the live catalog. Throws when the catalog is unreachable. */
  async searchOperations(options: HostOperationSearchOptions = {}) {
    // Host-admin ops are served by the dedicated pe_status/pe_logs tools and
    // scripting by the script_execute tool; hiding them here keeps exactly one
    // door per capability.
    const operations = (await this.catalog()).filter(
      (operation) => !isHiddenFromCatalogProjection(operation.key),
    );
    if (options.projection === "capability-map") return renderCapabilityMap(operations, options);
    return searchHostOperations(operations, options);
  }

  async callOperation(
    key: string,
    request?: unknown,
    verbosity: HostOperationVerbosity = "compact",
  ): Promise<HostOperationCallResult> {
    const operation = await this.getOperation(key);
    return Effect.runPromise(
      callHostRpcOperationEffect(this.options, key, operation, request, verbosity),
    );
  }

  private catalog(): Promise<HostOperationDefinition[]> {
    if (this.options.catalogOverride) return Promise.resolve([...this.options.catalogOverride]);
    return loadCatalog(this.options.hostBaseUrl, this.options.bridgeSessionId);
  }
}

function searchHostOperations(
  operations: readonly HostOperationDefinition[],
  options: HostOperationSearchOptions,
): HostOperationSearchResult[] {
  const queryTerms = normalizeQuery(options.query);
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 50);
  const verbosity = options.verbosity ?? "compact";
  const matchedOperations = operations
    .filter((operation) => matchesFilters(operation, options))
    .map((operation) => ({ operation, score: scoreOperation(operation, queryTerms) }))
    .filter(({ score }) => queryTerms.length === 0 || score > 0);

  if (matchedOperations.length === 0 && shouldHintScriptExecuteTool(options, queryTerms))
    return [scriptExecuteToolHint];

  return matchedOperations
    .sort(
      (left, right) =>
        right.score - left.score || left.operation.key.localeCompare(right.operation.key),
    )
    .slice(0, limit)
    .map(({ operation }) => toSearchResult(operation, verbosity));
}

// Mutation searches that match no catalog operation fall back to scripting, which
// lives behind the dedicated script_execute TOOL — not a catalog op, so the hint
// is synthetic rather than a catalog entry.
const scriptExecuteToolHint: HostOperationSearchResult = {
  key: "script_execute",
  displayName: "script_execute (dedicated tool)",
  description:
    "No catalog operation covers this mutation. Scripting is not a catalog op: use the script_execute tool to run a C# script against the Revit API; script_bootstrap prepares a workspace.",
  safety: "mutation",
  requestTypeName: "n/a",
  responseTypeName: "n/a",
  requestHint: "Call the script_execute tool directly; host_operation_call does not apply.",
  usageHint: "Use the script_execute tool (inline snippet or workspace file).",
};

function shouldHintScriptExecuteTool(
  options: HostOperationSearchOptions,
  queryTerms: string[],
): boolean {
  if (queryTerms.length === 0 || options.intent !== "Mutate") return false;
  const domain = options.domain?.trim().toLowerCase();
  return !domain || domain === "scripting";
}

const callHostRpcOperationEffect = Effect.fnUntraced(function* (
  options: HostRpcCallerOptions,
  key: string,
  operation: HostOperationDefinition | undefined,
  request: unknown,
  verbosity: HostOperationVerbosity,
) {
  const startedAt = Date.now();
  const result = yield* Effect.result(callHostRpcEffect(key, request, options));
  if (result._tag === "Success") {
    return {
      ok: true,
      key,
      elapsedMs: Date.now() - startedAt,
      operation:
        operation && verbosity !== "compact" ? toSearchResult(operation, verbosity) : undefined,
      response: result.success.rawBody,
    } satisfies HostOperationCallResult;
  }

  const error = result.failure;
  const searchResult = operation ? toSearchResult(operation, "full") : undefined;
  return {
    ok: false,
    key,
    elapsedMs: Date.now() - startedAt,
    operation: searchResult,
    status: error instanceof HostCallError ? error.status : undefined,
    message: error instanceof Error ? error.message : String(error),
    problem: error instanceof HostCallError ? error.problem : undefined,
    bestRequestExample: operation?.requestExamples?.[0],
    nextSteps: createFailureNextSteps(operation, error),
  } satisfies HostOperationCallResult;
});

const callHostRpcEffect = Effect.fnUntraced(function* (
  key: string,
  request: unknown,
  options: HostRpcCallerOptions,
) {
  const started = performance.now();
  const rawBody = yield* runHostRpcEffect(key, request, options);
  return { status: 200, elapsedMs: Math.round(performance.now() - started), rawBody };
});

// Plain POST /call — unknown keys pass through so runtime-registered Revit ops
// are callable without a package rebuild; the host/Revit side owns validation.
const runHostRpcEffect = Effect.fnUntraced(function* (
  key: string,
  request: unknown,
  options: HostRpcCallerOptions,
) {
  const base = trimTrailingSlash(options.hostBaseUrl ?? hostProcessIdentity.defaultHostBaseUrl);
  return yield* Effect.tryPromise({
    try: async () => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (options.bridgeSessionId)
        headers[HOST_RPC_BRIDGE_SESSION_HEADER] = options.bridgeSessionId;
      const response = await fetch(`${base}/call`, {
        method: "POST",
        headers,
        body: JSON.stringify({ key, request }),
        signal:
          options.timeoutMs == null
            ? undefined
            : AbortSignal.timeout(Math.max(options.timeoutMs, 1)),
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => undefined)) as
          | { kind?: string; message?: string }
          | undefined;
        throw new HostCallError(
          `${key}: ${problem?.message ?? response.statusText}`,
          response.status,
          {
            kind: problem?.kind,
            operationKey: key,
            title: problem?.message ?? response.statusText,
            status: response.status,
          },
        );
      }
      return (await response.json()) as unknown;
    },
    catch: (error) =>
      error instanceof HostCallError
        ? error
        : new HostCallError(`${key}: ${String(error)}`, 0, {
            operationKey: key,
            title: String(error),
            status: 0,
          }),
  });
});

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function matchesFilters(
  operation: HostOperationDefinition,
  options: HostOperationSearchOptions,
): boolean {
  return (
    matchesDomain(operation, options.domain) &&
    (!options.intent || operation.intent === options.intent) &&
    (options.requiresActiveDocument == null ||
      operation.requiresActiveDocument === options.requiresActiveDocument) &&
    (!options.visibility || operation.visibility === options.visibility)
  );
}

function matchesDomain(operation: HostOperationDefinition, domain: string | undefined): boolean {
  if (!domain?.trim()) return true;
  const expected = domain.trim().toLowerCase();
  return inferDomain(operation.key) === expected;
}

function scoreOperation(operation: HostOperationDefinition, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 1;
  const haystack = [
    operation.key,
    operation.displayName,
    operation.description,
    inferDomain(operation.key),
    operation.requestTypeName,
    operation.responseTypeName,
    operation.costTier,
    ...(operation.searchTerms ?? []),
    ...(operation.callGuidance ?? []),
    ...(operation.requestExamples ?? []).flatMap((example) => [
      example.name,
      example.description,
      example.json,
    ]),
  ]
    .filter((value): value is string => value != null && value.length > 0)
    .join(" ")
    .toLowerCase();
  return queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function toSearchResult(
  operation: HostOperationDefinition,
  verbosity: HostOperationVerbosity,
): HostOperationSearchResult {
  const requestHint = createRequestHint(operation);
  const result = {
    key: operation.key,
    displayName: operation.displayName ?? operation.key,
    description: operation.description ?? operation.key,
    safety: [operation.requiresActiveDocument ? "active-doc" : undefined, operation.costTier]
      .filter((value): value is string => value != null)
      .join(", "),
    costTier: operation.costTier,
    visibility: operation.visibility,
    safeDefaultRequestJson: operation.safeDefaultRequestJson,
    requestTypeName: operation.requestTypeName ?? "unknown",
    responseTypeName: operation.responseTypeName ?? "unknown",
    requestHint,
    bestRequestExample: operation.requestExamples?.[0],
    usageHint:
      operation.requestTypeName === "NoRequest"
        ? `host_operation_call key=${operation.key}`
        : `host_operation_call key=${operation.key} request=${requestHint}`,
  } satisfies HostOperationSearchResult;

  if (verbosity === "compact") return result;
  return {
    ...result,
    searchTerms: operation.searchTerms ?? [],
    requiresActiveDocument: operation.requiresActiveDocument ?? false,
  };
}

function createRequestHint(operation: HostOperationDefinition): string {
  if (operation.requestTypeName === "NoRequest") return "omit request";
  const example = operation.requestExamples?.[0];
  if (example) return `${operation.requestTypeName ?? "request object"}; example '${example.name}'`;
  if (operation.safeDefaultRequestJson)
    return `${operation.requestTypeName ?? "request object"}; safe default ${operation.safeDefaultRequestJson}`;
  return `${operation.requestTypeName ?? "request object"} JSON object`;
}

function renderCapabilityMap(
  operations: readonly HostOperationDefinition[],
  options: HostOperationSearchOptions,
) {
  const queryTerms = normalizeQuery(options.query);
  const sections = buildCapabilityMapSections(operations)
    .map((section) => ({
      ...section,
      rows: section.rows.filter(
        (row) =>
          queryTerms.length === 0 ||
          queryTerms.some((term) => Object.values(row).join(" ").toLowerCase().includes(term)),
      ),
    }))
    .filter((section) => section.rows.length > 0);
  return {
    kind: "hostCapabilityMap",
    format: options.capabilityMapFormat ?? "markdown",
    generatedFrom: "host.ops.catalog",
    formatVersion: 1,
    rowCount: sections.reduce((count, section) => count + section.rows.length, 0),
    guidance:
      "Table-of-contents routing map only. Use projection=matches for call guidance and exact request/response shapes.",
    matchedOperationKeys: sections.flatMap((section) => section.rows.map((row) => row.key)),
    rendered: renderCapabilityMapMarkdown(sections),
    sections,
    nextSteps: ["Use projection=matches for ranked operation search results."],
  };
}

function buildCapabilityMapSections(
  catalogOperations: readonly HostOperationDefinition[],
): HostCapabilityMapSection[] {
  const operations = [...catalogOperations].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  const sections = [
    createLayerSection(
      "context",
      "Context",
      "Cheap current Revit document, active view, selection, and session orientation.",
      "Context",
      operations,
    ),
    createLayerSection(
      "catalog",
      "Catalog",
      "Cheap/bounded inventories of candidate schedules, families, parameters, browser paths, and model nouns.",
      "Catalog",
      operations,
    ),
    createLayerSection(
      "matrix",
      "Matrix",
      "Bounded joins and audits after context/catalog narrowing.",
      "Matrix",
      operations,
    ),
    createLayerSection(
      "detail",
      "Detail",
      "Exact inspection of known schedules, sheets, elements, rows, or panel schedules.",
      "Detail",
      operations,
    ),
    createLayerSection(
      "resolve",
      "Resolve",
      "Fuzzy human references into stable handles before detail or matrix calls.",
      "Resolve",
      operations,
    ),
    createLayerSection(
      "apply",
      "Apply",
      "Explicit host/Revit state changes after discovery and inspection.",
      "Apply",
      operations,
    ),
    createDomainSection(
      "settings",
      "Settings",
      "Schema-backed settings/profile authoring, validation, field options, and workspaces.",
      "settings",
      operations,
    ),
    // No Scripting section: scripting.* is control plane, hidden from the catalog
    // projection — the script_execute tool is the one scripting door.
  ].filter((section) => section.rows.length > 0);
  const covered = new Set(sections.flatMap((section) => section.rows.map((row) => row.key)));
  const otherRows = operations
    .filter((operation) => !covered.has(operation.key))
    .map(toCapabilityRow);
  if (otherRows.length > 0)
    sections.push({
      id: "other",
      title: "Other",
      summary: "Public operations not covered by the primary routing sections.",
      rows: otherRows,
    });
  return sections;
}

function createLayerSection(
  id: string,
  title: string,
  summary: string,
  layer: RevitOperationLayer,
  operations: readonly HostOperationDefinition[],
): HostCapabilityMapSection {
  return {
    id,
    title,
    summary,
    rows: operations
      .filter((operation) => inferRevitLayer(operation.key) === layer)
      .map(toCapabilityRow),
  };
}

function createDomainSection(
  id: string,
  title: string,
  summary: string,
  domain: string,
  operations: readonly HostOperationDefinition[],
): HostCapabilityMapSection {
  return {
    id,
    title,
    summary,
    rows: operations
      .filter((operation) => inferDomain(operation.key) === domain)
      .map(toCapabilityRow),
  };
}

function toCapabilityRow(operation: HostOperationDefinition): HostCapabilityMapRow {
  return {
    key: operation.key,
    description: operation.description ?? operation.displayName ?? operation.key,
    safety: [operation.requiresActiveDocument ? "active-doc" : undefined, operation.costTier]
      .filter((value): value is string => value != null && value.length > 0)
      .join(", "),
    inputKind: formatCapabilityInputKind(operation),
    outputKind: formatCapabilityOutputKind(operation),
    terms: (operation.searchTerms ?? []).join("|"),
  };
}

function formatCapabilityInputKind(operation: HostOperationDefinition): string {
  if (operation.requestTypeName === "NoRequest") return "none";
  switch (inferRevitLayer(operation.key)) {
    case "Context":
      return "context scope";
    case "Catalog":
      return "bounded filters";
    case "Matrix":
      return "scoped audit query";
    case "Detail":
      return "known handles or filters";
    case "Resolve":
      return "reference text/context";
    case "Apply":
      return "explicit mutation request";
    default:
      return inferDomain(operation.key) === "settings"
        ? "settings/profile request"
        : "typed request";
  }
}

function formatCapabilityOutputKind(operation: HostOperationDefinition): string {
  switch (inferRevitLayer(operation.key)) {
    case "Context":
      return "current state summary";
    case "Catalog":
      return "candidate handles/list";
    case "Matrix":
      return "join/audit results";
    case "Detail":
      return "detail records";
    case "Resolve":
      return "resolved references";
    case "Apply":
      return "mutation result";
    default:
      return inferDomain(operation.key) === "settings" ? "settings/profile result" : "typed result";
  }
}

function inferRevitLayer(key: string): RevitOperationLayer | undefined {
  const [domain, layer] = key.split(".");
  if (domain !== "revit") return undefined;
  switch (layer) {
    case "context":
      return "Context";
    case "catalog":
      return "Catalog";
    case "matrix":
      return "Matrix";
    case "detail":
      return "Detail";
    case "resolve":
      return "Resolve";
    case "apply":
      return "Apply";
    default:
      return undefined;
  }
}

function inferDomain(key: string): string {
  return key.split(".", 1)[0].toLowerCase();
}

function renderCapabilityMapMarkdown(sections: readonly HostCapabilityMapSection[]): string {
  return sections
    .flatMap((section) => [
      `## ${section.title}`,
      section.summary,
      ...section.rows.map((row) => `- ${row.key}: ${row.description}`),
      "",
    ])
    .join("\n")
    .trimEnd();
}

function createFailureNextSteps(
  operation: HostOperationDefinition | undefined,
  error: unknown,
): string[] {
  if (operation == null) return ["Use host_operation_search to verify the operation key."];
  if (error instanceof HostCallError && error.status === 400)
    return [`Check the JSON request against ${createRequestHint(operation)}.`];
  return [
    "Check pe_status for bridge/session connectivity; if it shows a failure, read pe_logs, then retry with a bounded request.",
  ];
}

function normalizeQuery(query: string | undefined): string[] {
  return (query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1);
}
