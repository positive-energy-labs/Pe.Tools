import { sendJson, PeHostClientError, type HostExecutionMode, type HostOperationCostTier, type HostOperationDefinition, type HostOperationFamily, type HostOperationIntent, type HostOperationRequestExample, type HostOperationResultGrain, type HostTypeShapeField, type PeHostClientOptions, type RevitOperationLayer } from "./host-client-runtime.js";
import { hostOperations, type HostOperationKey } from "./generated/host-operations.generated.js";

export type HostOperationVerbosity = "compact" | "hints" | "full";

export interface HostOperationSearchOptions {
  query?: string;
  domain?: string;
  executionMode?: HostExecutionMode;
  intent?: HostOperationIntent;
  requiresBridge?: boolean;
  requiresActiveDocument?: boolean;
  limit?: number;
  verbosity?: HostOperationVerbosity;
}

export interface HostOperationCompactResult {
  key: string;
  displayName: string;
  summary: string;
  family?: HostOperationFamily;
  revitLayer?: RevitOperationLayer | null;
  domainNoun?: string;
  resultGrain?: HostOperationResultGrain;
  costTier?: HostOperationCostTier;
  requestTypeName: string;
  responseTypeName: string;
  requestHint: string;
  bestRequestExample?: HostOperationRequestExample;
  preflightHints: readonly string[];
  usageHint: string;
}

export interface HostOperationHintResult extends HostOperationCompactResult {
  domain: string;
  tags: readonly string[];
  executionMode: HostExecutionMode;
  intent: HostOperationIntent;
  requiresBridge: boolean;
  requiresActiveDocument: boolean;
  singleFlightGroup?: string | null;
  strictRequestValidation?: boolean;
  boundedExpansionHints: readonly string[];
  requestExamples: readonly HostOperationRequestExample[];
}

export interface HostOperationFullResult extends HostOperationHintResult {
  verb: string;
  route: string;
  requestShape: readonly HostTypeShapeField[];
  responseShape: readonly HostTypeShapeField[];
}

export type HostOperationSearchResult = HostOperationCompactResult | HostOperationHintResult | HostOperationFullResult;

export type HostOperationCallResult =
  | {
      ok: true;
      key: string;
      operation?: HostOperationSearchResult;
      response: unknown;
    }
  | {
      ok: false;
      key: string;
      operation: HostOperationFullResult;
      status?: number;
      message: string;
      problem?: unknown;
      bestRequestExample?: HostOperationRequestExample;
      nextSteps: readonly string[];
    };

export function listHostOperations(): HostOperationDefinition[] {
  return Object.values(hostOperations);
}

export function getHostOperation(key: string): HostOperationDefinition | undefined {
  return hostOperations[key as HostOperationKey];
}

export function searchHostOperations(options: HostOperationSearchOptions = {}): HostOperationSearchResult[] {
  const queryTerms = normalizeQuery(options.query);
  const verbosity = options.verbosity ?? "compact";
  const requestedLimit = options.limit ?? (verbosity === "full" ? 12 : 8);
  const maxLimit = verbosity === "full" ? 50 : 25;
  const limit = Math.min(Math.max(requestedLimit, 1), maxLimit);

  return listHostOperations()
    .filter((operation) => matchesFilters(operation, options))
    .map((operation) => ({ operation, score: scoreOperation(operation, queryTerms) }))
    .filter((entry) => queryTerms.length === 0 || entry.score > 0)
    .sort((left, right) => right.score - left.score || left.operation.key.localeCompare(right.operation.key))
    .slice(0, limit)
    .map((entry) => toSearchResult(entry.operation, verbosity));
}

export async function callHostOperation(
  options: PeHostClientOptions,
  key: string,
  request?: unknown,
  verbosity: HostOperationVerbosity = "compact",
): Promise<HostOperationCallResult> {
  const operation = getHostOperation(key);
  if (!operation)
    throw new Error(`Unknown host operation '${key}'. Use host_operation_search first.`);

  try {
    const response = await sendJson<unknown, unknown>(options, operation, normalizeRequest(operation, request));
    return {
      ok: true,
      key: operation.key,
      operation: verbosity === "compact" ? undefined : toSearchResult(operation, verbosity),
      response,
    };
  } catch (error) {
    const searchResult = toFullSearchResult(operation);
    if (error instanceof PeHostClientError) {
      return {
        ok: false,
        key: operation.key,
        operation: searchResult,
        status: error.status,
        message: error.message,
        problem: error.problem,
        bestRequestExample: getBestRequestExample(operation),
        nextSteps: createFailureNextSteps(operation, error),
      };
    }

    return {
      ok: false,
      key: operation.key,
      operation: searchResult,
      message: error instanceof Error ? error.message : String(error),
      bestRequestExample: getBestRequestExample(operation),
      nextSteps: createFailureNextSteps(operation, error),
    };
  }
}

function normalizeRequest(operation: HostOperationDefinition, request: unknown): unknown {
  if (operation.requestTypeName === "NoRequest")
    return undefined;

  if (request == null)
    return {};

  return request;
}

function createFailureNextSteps(operation: HostOperationDefinition, error: unknown): string[] {
  const hints = [...createPreflightHints(operation)];
  if (!(error instanceof PeHostClientError)) {
    hints.unshift("Pe.Host was not reachable. Start Pe.Host or pass the correct host base URL, then retry.");
    return unique(hints);
  }

  if (error.status === 503 && (operation.requiresBridge || operation.executionMode === "Bridge"))
    hints.unshift("Pe.Host is reachable, but this operation needs the Revit bridge. Open Revit and reconnect the bridge; use pe_status only if exact fresh state is needed.");
  else if (error.status === 400)
    hints.unshift(`Check the JSON request against ${createRequestHint(operation)}${formatBestExampleReference(operation)}.`);
  else if (error.status === 404)
    hints.unshift("The host does not expose this operation at the current route. Check that Pe.Host and pea were generated from the same contracts.");
  else
    hints.unshift("Read pe_logs for nearby host/Revit errors if the problem is not clear from the response payload.");

  return unique(hints);
}

function matchesFilters(operation: HostOperationDefinition, options: HostOperationSearchOptions): boolean {
  return matchesText(operation.domain, options.domain)
    && (!options.executionMode || operation.executionMode === options.executionMode)
    && (!options.intent || operation.intent === options.intent)
    && (options.requiresBridge == null || operation.requiresBridge === options.requiresBridge)
    && (options.requiresActiveDocument == null || operation.requiresActiveDocument === options.requiresActiveDocument);
}

function scoreOperation(operation: HostOperationDefinition, queryTerms: string[]): number {
  if (queryTerms.length === 0)
    return 1;

  const fields = [
    operation.key,
    operation.displayName,
    operation.domain,
    operation.summary,
    operation.requestTypeName,
    operation.responseTypeName,
    operation.family,
    operation.revitLayer ?? undefined,
    operation.domainNoun,
    operation.resultGrain,
    operation.costTier,
    operation.singleFlightGroup ?? undefined,
    operation.handleProvenanceNotes ?? undefined,
    ...(operation.tags ?? []),
    ...(operation.boundedExpansionHints ?? []),
    ...(operation.requestExamples ?? []).flatMap((example) => [example.name, example.description, example.json]),
  ].filter((value): value is string => value != null);

  const haystack = fields.join(" ").toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (!haystack.includes(term))
      continue;

    score += 1;
    if (operation.key.toLowerCase().includes(term))
      score += 3;
    if (operation.displayName?.toLowerCase().includes(term))
      score += 2;
    if (operation.tags?.some((tag) => tag.toLowerCase().includes(term)))
      score += 2;
  }

  return score;
}

function normalizeQuery(query: string | undefined): string[] {
  return (query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function matchesText(value: string | undefined, expected: string | undefined): boolean {
  return expected == null || expected.trim().length === 0 || value?.toLowerCase() === expected.toLowerCase();
}

function toSearchResult(operation: HostOperationDefinition, verbosity: HostOperationVerbosity): HostOperationSearchResult {
  if (verbosity === "full")
    return toFullSearchResult(operation);

  const hintResult = toHintSearchResult(operation);
  if (verbosity === "hints")
    return hintResult;

  return {
    key: hintResult.key,
    displayName: hintResult.displayName,
    summary: hintResult.summary,
    family: hintResult.family,
    revitLayer: hintResult.revitLayer,
    domainNoun: hintResult.domainNoun,
    resultGrain: hintResult.resultGrain,
    costTier: hintResult.costTier,
    requestTypeName: hintResult.requestTypeName,
    responseTypeName: hintResult.responseTypeName,
    requestHint: hintResult.requestHint,
    bestRequestExample: hintResult.bestRequestExample,
    preflightHints: hintResult.preflightHints,
    usageHint: hintResult.usageHint,
  };
}

function toHintSearchResult(operation: HostOperationDefinition): HostOperationHintResult {
  const requestHint = createRequestHint(operation);
  const bestRequestExample = getBestRequestExample(operation);
  return {
    key: operation.key,
    displayName: operation.displayName ?? operation.key,
    domain: operation.domain ?? "host",
    summary: operation.summary ?? operation.displayName ?? operation.key,
    tags: operation.tags ?? [],
    executionMode: operation.executionMode,
    intent: operation.intent ?? "Read",
    family: operation.family,
    revitLayer: operation.revitLayer,
    domainNoun: operation.domainNoun,
    resultGrain: operation.resultGrain,
    costTier: operation.costTier,
    singleFlightGroup: operation.singleFlightGroup,
    strictRequestValidation: operation.strictRequestValidation,
    requiresBridge: operation.requiresBridge ?? operation.executionMode === "Bridge",
    requiresActiveDocument: operation.requiresActiveDocument ?? false,
    requestTypeName: operation.requestTypeName ?? "unknown",
    responseTypeName: operation.responseTypeName ?? "unknown",
    requestHint,
    bestRequestExample,
    preflightHints: createPreflightHints(operation),
    usageHint: createUsageHint(operation, bestRequestExample, requestHint),
    boundedExpansionHints: operation.boundedExpansionHints ?? [],
    requestExamples: operation.requestExamples ?? [],
  };
}

function toFullSearchResult(operation: HostOperationDefinition): HostOperationFullResult {
  return {
    ...toHintSearchResult(operation),
    verb: operation.verb,
    route: operation.route,
    requestShape: operation.requestShape ?? [],
    responseShape: operation.responseShape ?? [],
  };
}

function createRequestHint(operation: HostOperationDefinition): string {
  if (operation.requestTypeName === "NoRequest")
    return "omit request";

  const example = getBestRequestExample(operation);
  if (example)
    return `${operation.requestTypeName ?? "request object"}; best example '${example.name}'`;

  const fields = formatShape(operation.requestShape ?? []);
  return fields.length === 0
    ? `${operation.requestTypeName ?? "request object"} JSON object`
    : `${operation.requestTypeName ?? "request object"} { ${fields} }`;
}

function createUsageHint(
  operation: HostOperationDefinition,
  example: HostOperationRequestExample | undefined,
  requestHint: string,
): string {
  if (operation.requestTypeName === "NoRequest")
    return `host_operation_call key=${operation.key}`;

  if (example)
    return `host_operation_call key=${operation.key} requestJson=${example.json}`;

  return `host_operation_call key=${operation.key} request=${requestHint}`;
}

function getBestRequestExample(operation: HostOperationDefinition): HostOperationRequestExample | undefined {
  return operation.requestExamples?.[0];
}

function formatBestExampleReference(operation: HostOperationDefinition): string {
  const example = getBestRequestExample(operation);
  return example ? `; start from example '${example.name}'` : "";
}

function createPreflightHints(operation: HostOperationDefinition): string[] {
  const hints: string[] = [];
  if (operation.executionMode === "Bridge" || operation.requiresBridge)
    hints.push("Requires Pe.Host's Revit bridge; rely on injected status for routine orientation; use pe_status only for explicit freshness/debug.");
  if (operation.singleFlightGroup)
    hints.push(`Single-flight group '${operation.singleFlightGroup}'; do not call bridge-backed operations in parallel.`);
  if (operation.requiresActiveDocument)
    hints.push("Requires an active Revit document before calling.");
  if (operation.costTier === "Expensive")
    hints.push("Expensive projection; prefer context/catalog/resolve operations first and keep filters bounded.");
  if (operation.strictRequestValidation)
    hints.push("Strict request validation; unknown or nonsensical fields fail instead of silently broadening results.");
  if (operation.intent === "Mutate")
    hints.push("May modify host/Revit state; inspect the request before calling.");
  return hints;
}

function formatShape(fields: readonly HostTypeShapeField[]): string {
  return fields
    .map((field) => `${field.name}${field.required ? "" : "?"}: ${field.type}`)
    .join(", ");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
