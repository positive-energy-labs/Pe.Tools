import { sendJson, PeHostClientError, type HostExecutionMode, type HostOperationCostTier, type HostOperationDefinition, type HostOperationFamily, type HostOperationIntent, type HostOperationIntentVerb, type HostOperationRequestExample, type HostOperationRequestShapeKind, type HostOperationResultGrain, type HostOperationVisibility, type HostTypeShapeField, type PeHostClientOptions, type RevitOperationLayer } from "./host-client-runtime.js";
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
  visibility?: HostOperationVisibility;
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
  visibility?: HostOperationVisibility;
  canonicalUse?: string;
  intentVerb?: HostOperationIntentVerb;
  requestShapeKind?: HostOperationRequestShapeKind;
  safeDefaultRequestJson?: string | null;
  nextOperations?: readonly string[];
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
  useWhen: readonly string[];
  doNotUseWhen: readonly string[];
  usuallyBefore: readonly string[];
  usuallyAfter: readonly string[];
  answersQuestionTypes: readonly string[];
  doesNotAnswer: readonly string[];
  primaryNouns: readonly string[];
  supportedScopes: readonly string[];
  capabilities: readonly string[];
  ambiguityBehavior?: string | null;
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
      requestId: string;
      elapsedMs: number;
      queuedMs?: number;
      operation?: HostOperationSearchResult;
      response: unknown;
    }
  | {
      ok: false;
      key: string;
      requestId: string;
      elapsedMs: number;
      queuedMs?: number;
      operation: HostOperationFullResult;
      status?: number;
      message: string;
      problem?: unknown;
      bestRequestExample?: HostOperationRequestExample;
      nextSteps: readonly string[];
    };

const singleFlightQueues = new Map<string, Promise<void>>();

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
    .filter((entry) => isVisibleForSearch(entry.operation, queryTerms, options) && (queryTerms.length === 0 || entry.score > 0))
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

  const requestId = options.requestId ?? createRequestId();
  const startedAt = Date.now();
  const runStartedAt = { value: startedAt };
  try {
    const response = await runWithSingleFlight(operation, async () => {
      runStartedAt.value = Date.now();
      return sendJson<unknown, unknown>(
        { ...options, requestId },
        operation,
        normalizeRequest(operation, request),
      );
    });
    const elapsedMs = Date.now() - startedAt;
    const queuedMs = Math.max(0, runStartedAt.value - startedAt);
    return {
      ok: true,
      key: operation.key,
      requestId,
      elapsedMs,
      ...(queuedMs > 0 ? { queuedMs } : {}),
      operation: verbosity === "compact" ? undefined : toSearchResult(operation, verbosity),
      response,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const queuedMs = Math.max(0, runStartedAt.value - startedAt);
    const searchResult = toFullSearchResult(operation);
    if (error instanceof PeHostClientError) {
      return {
        ok: false,
        key: operation.key,
        requestId,
        elapsedMs,
        ...(queuedMs > 0 ? { queuedMs } : {}),
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
      requestId,
      elapsedMs,
      ...(queuedMs > 0 ? { queuedMs } : {}),
      operation: searchResult,
      message: error instanceof Error ? error.message : String(error),
      bestRequestExample: getBestRequestExample(operation),
      nextSteps: createFailureNextSteps(operation, error),
    };
  }
}


async function runWithSingleFlight<T>(operation: HostOperationDefinition, action: () => Promise<T>): Promise<T> {
  const group = getSingleFlightGroup(operation);
  if (!group)
    return action();

  const previous = singleFlightQueues.get(group) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  singleFlightQueues.set(group, queued);

  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (singleFlightQueues.get(group) === queued)
      singleFlightQueues.delete(group);
  }
}

function getSingleFlightGroup(operation: HostOperationDefinition): string | undefined {
  if (operation.singleFlightGroup)
    return operation.singleFlightGroup;
  return operation.executionMode === "Bridge" && operation.key.startsWith("revit.") ? "revit" : undefined;
}

function normalizeRequest(operation: HostOperationDefinition, request: unknown): unknown {
  if (operation.requestTypeName === "NoRequest")
    return undefined;

  if (request == null)
    return {};

  return request;
}

function createRequestId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `pea-${Date.now().toString(36)}-${random}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function createFailureNextSteps(operation: HostOperationDefinition, error: unknown): string[] {
  const hints = [...createPreflightHints(operation)];
  if (!(error instanceof PeHostClientError)) {
    if (isAbortError(error)) {
      hints.unshift("The host operation timed out client-side. Do not immediately retry broad bridge work; use pe_logs to find the request id and check whether Revit is still finishing it.");
      hints.unshift("For Revit single-flight operations, wait for the current bridge call to finish before sending another bridge-backed host_operation_call.");
    } else {
      hints.unshift("Pe.Host was not reachable. Start Pe.Host or pass the correct host base URL, then retry.");
    }
    return unique(hints);
  }

  if (error.status === 503 && (operation.requiresBridge || operation.executionMode === "Bridge"))
    hints.unshift("Pe.Host is reachable, but this operation needs the Revit bridge. Open Revit and reconnect the bridge; use pe_status only if exact fresh state is needed.");
  else if (error.status === 409 && (operation.singleFlightGroup || operation.executionMode === "Bridge"))
    hints.unshift("A bridge/Revit precondition or single-flight conflict blocked the call. Wait for the active Revit operation to finish, inspect pe_status/pe_logs if needed, then retry with a narrower request.");
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
    && (options.requiresActiveDocument == null || operation.requiresActiveDocument === options.requiresActiveDocument)
    && (!options.visibility || operation.visibility === options.visibility);
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
    operation.visibility,
    operation.canonicalUse,
    operation.intentVerb,
    operation.requestShapeKind,
    operation.safeDefaultRequestJson ?? undefined,
    operation.ambiguityBehavior ?? undefined,
    ...(operation.tags ?? []),
    ...(operation.boundedExpansionHints ?? []),
    ...(operation.useWhen ?? []),
    ...(operation.doNotUseWhen ?? []),
    ...(operation.usuallyBefore ?? []),
    ...(operation.usuallyAfter ?? []),
    ...(operation.nextOperations ?? []),
    ...(operation.answersQuestionTypes ?? []),
    ...(operation.doesNotAnswer ?? []),
    ...(operation.primaryNouns ?? []),
    ...(operation.supportedScopes ?? []),
    ...(operation.capabilities ?? []),
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

  if (operation.visibility === "DefaultVisible")
    score += 2;
  if (operation.visibility === "ExpertOnly" && !queryNamesEscalation(operation, queryTerms))
    score -= 4;
  if (operation.visibility === "EscalationVisible" && !queryNamesEscalation(operation, queryTerms))
    score -= 1;
  if (operation.revitLayer === "Catalog" && queryNamesAny(queryTerms, ["schedule", "schedules", "family", "families", "parameter", "parameters", "binding", "bindings", "browser", "sheet", "sheets", "view", "views"]))
    score += 2;
  if (operation.key === "revit.catalog.schedules" && queryNamesAny(queryTerms, ["missing", "coverage", "covered", "scheduled", "schedules", "rows", "fields"]))
    score += 3;
  if (operation.key === "revit.matrix.schedule-coverage" && queryNamesAny(queryTerms, ["missing", "coverage", "covered", "scheduled", "schedules"]))
    score += 4;
  if ((operation.revitLayer === "Matrix" || operation.revitLayer === "Detail") && queryNamesAny(queryTerms, ["audit", "coverage", "missing", "blank", "default", "row", "rows", "detail", "matrix"]))
    score += 2;
  if (operation.revitLayer === "Detail" && !queryNamesAny(queryTerms, ["row", "rows", "cell", "cells", "detail", "known", "id", "ids"]))
    score -= 3;

  return score;
}

function isVisibleForSearch(
  operation: HostOperationDefinition,
  queryTerms: string[],
  options: HostOperationSearchOptions,
): boolean {
  if (options.visibility)
    return true;
  if (queryTerms.length === 0)
    return operation.visibility !== "ExpertOnly";
  if (isBroadRevitOrientationQuery(queryTerms))
    return operation.visibility === "DefaultVisible";
  if (operation.visibility === "DefaultVisible")
    return true;
  return queryNamesEscalation(operation, queryTerms);
}

function isBroadRevitOrientationQuery(queryTerms: string[]): boolean {
  const broadTerms = new Set(["current", "doing", "going", "happening", "model", "revit", "state"]);
  return queryTerms.length !== 0 && queryTerms.every((term) => broadTerms.has(term));
}

function queryNamesEscalation(operation: HostOperationDefinition, queryTerms: string[]): boolean {
  return queryNamesAny(queryTerms, [
    operation.domainNoun,
    operation.revitLayer,
    operation.intentVerb,
    operation.requestShapeKind,
    ...(operation.tags ?? []),
    ...(operation.primaryNouns ?? []),
    ...(operation.capabilities ?? []),
    ...(operation.nextOperations ?? []),
  ]);
}

function queryNamesAny(queryTerms: string[], values: readonly (string | undefined | null)[]): boolean {
  const normalizedValues = values
    .filter((value): value is string => value != null)
    .flatMap((value) => normalizeQuery(value));
  return queryTerms.some((term) => normalizedValues.some((value) => value === term || (term.length >= 4 && value.includes(term)) || (value.length >= 4 && term.includes(value))));
}

function normalizeQuery(query: string | undefined): string[] {
  const stopWords = new Set(["a", "an", "and", "are", "for", "in", "is", "me", "of", "on", "or", "the", "this", "that", "to", "what", "with"]);
  return (query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !stopWords.has(term));
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
    visibility: hintResult.visibility,
    canonicalUse: hintResult.canonicalUse,
    intentVerb: hintResult.intentVerb,
    requestShapeKind: hintResult.requestShapeKind,
    safeDefaultRequestJson: hintResult.safeDefaultRequestJson,
    nextOperations: hintResult.nextOperations,
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
    visibility: operation.visibility,
    canonicalUse: operation.canonicalUse,
    intentVerb: operation.intentVerb,
    requestShapeKind: operation.requestShapeKind,
    safeDefaultRequestJson: operation.safeDefaultRequestJson,
    nextOperations: operation.nextOperations ?? [],
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
    useWhen: operation.useWhen ?? [],
    doNotUseWhen: operation.doNotUseWhen ?? [],
    usuallyBefore: operation.usuallyBefore ?? [],
    usuallyAfter: operation.usuallyAfter ?? [],
    answersQuestionTypes: operation.answersQuestionTypes ?? [],
    doesNotAnswer: operation.doesNotAnswer ?? [],
    primaryNouns: operation.primaryNouns ?? [],
    supportedScopes: operation.supportedScopes ?? [],
    capabilities: operation.capabilities ?? [],
    ambiguityBehavior: operation.ambiguityBehavior,
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
  if (operation.safeDefaultRequestJson)
    return `${operation.requestTypeName ?? "request object"}; safe default ${operation.safeDefaultRequestJson}`;

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
  if (operation.safeDefaultRequestJson)
    return `host_operation_call key=${operation.key} requestJson=${operation.safeDefaultRequestJson}`;

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
  if (operation.requestShapeKind)
    hints.push(`Request shape: ${operation.requestShapeKind}.`);
  if (operation.safeDefaultRequestJson)
    hints.push(`Safe default request: ${operation.safeDefaultRequestJson}`);
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
