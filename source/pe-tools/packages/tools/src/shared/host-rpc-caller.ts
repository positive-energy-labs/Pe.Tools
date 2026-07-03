import { NodeHttpClient } from "@effect/platform-node";
import { Effect } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { callHostRpcMember } from "@pe/host-contracts/rpc";
import {
  hostOperations,
  hostProcessIdentity,
  type HostOperationCostTier,
  type HostOperationDefinition,
  type HostOperationIntent,
  type HostOperationRequestExample,
  type HostOperationVisibility,
} from "@pe/host-contracts/contracts";
import {
  HostCallError,
  isAnyOperationKey,
  isHostOperationKey,
  toHostCallError,
  type AnyOperationKey,
  type HostOpRequest,
  type HostOpResponse,
  type HostSessionScope,
} from "@pe/host-contracts/operation-types";

type HostRpcCallerOptions = HostSessionScope & {
  hostBaseUrl?: string;
  timeoutMs?: number;
};

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

  call<K extends AnyOperationKey>(key: K, request?: HostOpRequest<K>): Promise<HostOpResponse<K>> {
    return Effect.runPromise(
      callHostRpcEffect(key, request, this.options).pipe(
        Effect.map(({ rawBody }) => rawBody as HostOpResponse<K>),
      ),
    );
  }

  getOperation(key: string): HostOperationDefinition | undefined {
    return getHostOperation(key);
  }

  searchOperations(options: HostOperationSearchOptions = {}) {
    if (options.projection === "capability-map") return renderCapabilityMap(options);
    return searchHostOperations(options);
  }

  callOperation(
    key: string,
    request?: unknown,
    verbosity: HostOperationVerbosity = "compact",
  ): Promise<HostOperationCallResult> {
    return Effect.runPromise(callHostRpcOperationEffect(this.options, key, request, verbosity));
  }
}

function getHostOperation(key: string): HostOperationDefinition | undefined {
  return isHostOperationKey(key) ? hostOperations[key] : undefined;
}

function searchHostOperations(options: HostOperationSearchOptions): HostOperationSearchResult[] {
  const queryTerms = normalizeQuery(options.query);
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 50);
  const verbosity = options.verbosity ?? "compact";
  return Object.values(hostOperations)
    .filter((operation) => matchesFilters(operation, options))
    .map((operation) => ({ operation, score: scoreOperation(operation, queryTerms) }))
    .filter(({ score }) => queryTerms.length === 0 || score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.operation.key.localeCompare(right.operation.key),
    )
    .slice(0, limit)
    .map(({ operation }) => toSearchResult(operation, verbosity));
}

const callHostRpcOperationEffect = Effect.fnUntraced(function* (
  options: HostRpcCallerOptions,
  key: string,
  request: unknown,
  verbosity: HostOperationVerbosity,
) {
  const startedAt = Date.now();
  const operation = getHostOperation(key);

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

const runHostRpcEffect = Effect.fnUntraced(function* (
  key: string,
  request: unknown,
  options: HostRpcCallerOptions,
) {
  if (!isAnyOperationKey(key))
    return yield* Effect.fail(
      new HostCallError(`${key}: unknown operation '${key}'`, 404, {
        operationKey: key,
        title: `unknown operation '${key}'`,
        status: 404,
      }),
    );

  const baseProgram = callHostRpcMember(key, request, options).pipe(
    Effect.provide(
      RpcClient.layerProtocolHttp({
        url: `${trimTrailingSlash(options.hostBaseUrl ?? hostProcessIdentity.defaultHostBaseUrl)}/rpc`,
      }),
    ),
    Effect.provide(RpcSerialization.layerNdjson),
    Effect.provide(NodeHttpClient.layerUndici),
    Effect.mapError((error) => toHostCallError(key, error) ?? error),
    Effect.scoped,
  );
  const program =
    options.timeoutMs == null
      ? baseProgram
      : baseProgram.pipe(Effect.timeout(Math.max(options.timeoutMs, 1)));

  return yield* program;
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

function renderCapabilityMap(options: HostOperationSearchOptions) {
  const queryTerms = normalizeQuery(options.query);
  const sections = buildCapabilityMapSections()
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
    generatedFrom: "hostOperations",
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

function buildCapabilityMapSections(): HostCapabilityMapSection[] {
  const operations = Object.values(hostOperations).sort((left, right) =>
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
    createDomainSection(
      "script",
      "Scripting",
      "Host-owned C# scripting workspace bootstrap and execution.",
      "scripting",
      operations,
    ),
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
      switch (inferDomain(operation.key)) {
        case "settings":
          return "settings/profile request";
        case "scripting":
          return "workspace/script request";
        default:
          return "typed request";
      }
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
      switch (inferDomain(operation.key)) {
        case "settings":
          return "settings/profile result";
        case "scripting":
          return "workspace/script result";
        default:
          return "typed result";
      }
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
  return ["Confirm the Revit bridge is connected, then retry with a bounded request."];
}

function normalizeQuery(query: string | undefined): string[] {
  return (query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1);
}
