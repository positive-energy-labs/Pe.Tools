import { sendJson, PeHostClientError, type HostCapabilityMapRow, type HostCapabilityMapSection, type HostExecutionMode, type HostOperationCostTier, type HostOperationDefinition, type HostOperationIntent, type HostOperationRelatedOperation, type HostOperationRequestExample, type HostOperationVisibility, type HostTypeShapeField, type PeHostClientOptions, type RevitActiveDocumentKind } from "./host-client-runtime.js";
import { hostCapabilityMap } from "./generated/host-capability-map.generated.js";
import { hostOperations, type HostOperationKey } from "./generated/host-operations.generated.js";

export type HostOperationVerbosity = "compact" | "hints" | "full";
export type HostOperationSearchProjection = "matches" | "capability-map";
export type HostCapabilityMapFormat = "markdown" | "json" | "toon";

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
  projection?: HostOperationSearchProjection;
  capabilityMapFormat?: HostCapabilityMapFormat;
}

export interface HostOperationCompactResult {
  key: string;
  displayName: string;
  description: string;
  safety: string;
  costTier?: HostOperationCostTier;
  visibility?: HostOperationVisibility;
  safeDefaultRequestJson?: string | null;
  relatedOperations?: readonly HostOperationRelatedOperation[];
  requestTypeName: string;
  responseTypeName: string;
  requestHint: string;
  bestRequestExample?: HostOperationRequestExample;
  usageHint: string;
}

export interface HostOperationHintResult extends HostOperationCompactResult {
  searchTerms: readonly string[];
  executionMode: HostExecutionMode;
  requiresBridge: boolean;
  requiresActiveDocument: boolean;
  supportedActiveDocumentKinds: readonly RevitActiveDocumentKind[];
  singleFlightGroup?: string | null;
  strictRequestValidation?: boolean;
  callGuidance: readonly string[];
  requestExamples: readonly HostOperationRequestExample[];
}

export interface HostOperationFullResult extends HostOperationHintResult {
  verb: string;
  route: string;
  requestShape: readonly HostTypeShapeField[];
  responseShape: readonly HostTypeShapeField[];
}

export type HostOperationSearchResult = HostOperationCompactResult | HostOperationHintResult | HostOperationFullResult;

export interface HostCapabilityMapSearchResult {
  kind: "hostCapabilityMap";
  format: HostCapabilityMapFormat;
  generatedFrom: string;
  formatVersion: number;
  rowCount: number;
  guidance: string;
  matchedOperationKeys: readonly string[];
  rendered?: string;
  sections?: readonly HostCapabilityMapSection[];
  nextSteps: readonly string[];
}

export type HostOperationSearchOutput = HostOperationSearchResult[] | HostCapabilityMapSearchResult;

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

export function searchHostOperations(options: HostOperationSearchOptions = {}): HostOperationSearchOutput {
  if (options.projection === "capability-map")
    return renderHostCapabilityMapSearchResult(options);

  return searchHostOperationMatches(options);
}

export function searchHostOperationMatches(options: HostOperationSearchOptions = {}): HostOperationSearchResult[] {
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
  const localRequestProblem = createLocalRequestProblem(operation, request);
  if (localRequestProblem) {
    return {
      ok: false,
      key: operation.key,
      requestId,
      elapsedMs: Date.now() - startedAt,
      operation: toFullSearchResult(operation),
      status: 400,
      message: localRequestProblem,
      bestRequestExample: getBestRequestExample(operation),
      nextSteps: [
        localRequestProblem,
        `Check the JSON request against ${createRequestHint(operation)}${formatBestExampleReference(operation)}.`,
      ],
    };
  }

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


function renderHostCapabilityMapSearchResult(options: HostOperationSearchOptions): HostCapabilityMapSearchResult {
  const format = options.capabilityMapFormat ?? "markdown";
  const sections = selectCapabilityMapSections(options);
  const matchedOperationKeys = unique(sections.flatMap((section) => section.rows.map((row) => row.key)));
  return {
    kind: "hostCapabilityMap",
    format,
    generatedFrom: hostCapabilityMap.generatedFrom,
    formatVersion: hostCapabilityMap.formatVersion,
    rowCount: hostCapabilityMap.rowCount,
    guidance: hostCapabilityMap.guidance,
    matchedOperationKeys,
    ...(format === "json" ? { sections } : { rendered: format === "toon" ? renderCapabilityMapToon(sections) : renderCapabilityMapMarkdown(sections) }),
    nextSteps: [
      "Use projection=matches for ranked operation search results.",
      "Use verbosity=hints for request examples, call guidance, and related operations.",
      "Use verbosity=full when exact route and request/response fields are needed before host_operation_call.",
    ],
  };
}

function selectCapabilityMapSections(options: HostOperationSearchOptions): HostCapabilityMapSection[] {
  const queryTerms = normalizeQuery(options.query);
  const focusSections = filterCapabilityMapSections(hostCapabilityMap.focusSections, queryTerms, options, true);
  const baseSections = filterCapabilityMapSections(hostCapabilityMap.sections, queryTerms, options, false);
  const sections = focusSections.length === 0 ? baseSections : focusSections;
  const rankedSections = queryTerms.length === 0 ? sections : rankCapabilityMapSections(sections, queryTerms);
  const defaultLimit = queryTerms.length === 0 ? hostCapabilityMap.rowCount : 25;
  const limit = Math.min(Math.max(options.limit ?? defaultLimit, 1), 100);
  return trimCapabilityMapSections(rankedSections, limit);
}

function filterCapabilityMapSections(
  sections: readonly HostCapabilityMapSection[],
  queryTerms: string[],
  options: HostOperationSearchOptions,
  focusOnly: boolean,
): HostCapabilityMapSection[] {
  return sections
    .map((section) => {
      const sectionMatches = queryTerms.length !== 0 && textMatchesQueryTerms(`${section.id} ${section.title}`, queryTerms);
      if (focusOnly && queryTerms.length === 0)
        return { ...section, rows: [] };

      const rows = section.rows.filter((row) => {
        const operation = getHostOperation(row.key);
        if (operation && !matchesFilters(operation, options))
          return false;
        if (queryTerms.length === 0 || sectionMatches)
          return true;
        return textMatchesQueryTerms(Object.values(row).join(" "), queryTerms)
          || (operation != null && scoreOperation(operation, queryTerms) > 0);
      });
      return { ...section, rows };
    })
    .filter((section) => section.rows.length !== 0);
}

function rankCapabilityMapSections(
  sections: readonly HostCapabilityMapSection[],
  queryTerms: string[],
): HostCapabilityMapSection[] {
  return sections
    .map((section) => {
      const rows = [...section.rows].sort((left, right) => scoreCapabilityMapRow(right, queryTerms) - scoreCapabilityMapRow(left, queryTerms));
      return { ...section, rows };
    })
    .sort((left, right) => scoreCapabilityMapSection(right, queryTerms) - scoreCapabilityMapSection(left, queryTerms));
}

function scoreCapabilityMapSection(section: HostCapabilityMapSection, queryTerms: string[]): number {
  return Math.max(0, ...section.rows.map((row) => scoreCapabilityMapRow(row, queryTerms)));
}

function scoreCapabilityMapRow(row: HostCapabilityMapRow, queryTerms: string[]): number {
  const operation = getHostOperation(row.key);
  const operationScore = operation ? scoreOperation(operation, queryTerms) : 0;
  const rowText = Object.values(row).join(" ").toLowerCase();
  const rowScore = queryTerms.reduce((score, term) => score + (rowText.includes(term) ? 1 : 0), 0);
  return operationScore + rowScore;
}

function trimCapabilityMapSections(
  sections: HostCapabilityMapSection[],
  limit: number,
): HostCapabilityMapSection[] {
  let remaining = limit;
  const trimmed: HostCapabilityMapSection[] = [];
  for (const section of sections) {
    if (remaining <= 0)
      break;

    const rows = section.rows.slice(0, remaining);
    remaining -= rows.length;
    if (rows.length !== 0)
      trimmed.push({ ...section, rows });
  }
  return trimmed;
}

function renderCapabilityMapMarkdown(sections: readonly HostCapabilityMapSection[]): string {
  const lines = [
    "# Host capability map",
    hostCapabilityMap.guidance,
    "",
  ];
  if (sections.length === 0) {
    lines.push("No capability-map rows matched the filters. Use projection=matches for ranked search fallback.");
    return lines.join("\n");
  }

  for (const section of sections) {
    lines.push(`## ${section.title}`);
    lines.push(section.summary);
    lines.push("| key | area | description | safety | input | output | relations | terms |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const row of section.rows) {
      lines.push([
        row.key,
        row.area,
        row.description,
        row.safety,
        row.input,
        row.output,
        row.relations || "-",
        row.terms || "-",
      ].map((value) => escapeMarkdownCell(truncate(value, 160))).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function renderCapabilityMapToon(sections: readonly HostCapabilityMapSection[]): string {
  const rowFields = [
    "key",
    "area",
    "description",
    "safety",
    "input",
    "output",
    "relations",
    "terms",
  ] as const;
  const lines = [
    "kind: hostCapabilityMap",
    `generatedFrom: ${formatToonScalar(hostCapabilityMap.generatedFrom)}`,
    `guidance: ${formatToonScalar(hostCapabilityMap.guidance)}`,
    `sections[${sections.length}]:`,
  ];
  for (const section of sections) {
    lines.push(`  - id: ${formatToonScalar(section.id)}`);
    lines.push(`    title: ${formatToonScalar(section.title)}`);
    lines.push(`    summary: ${formatToonScalar(section.summary)}`);
    lines.push(`    rows[${section.rows.length}]{${rowFields.join(",")}}:`);
    for (const row of section.rows)
      lines.push(`      ${rowFields.map((field) => formatToonScalar(row[field])).join(",")}`);
  }
  return lines.join("\n");
}

function textMatchesQueryTerms(text: string, queryTerms: string[]): boolean {
  const haystack = text.toLowerCase();
  return queryTerms.some((term) => haystack.includes(term));
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatToonScalar(value: string): string {
  if (value.length === 0)
    return "\"\"";
  return /^[A-Za-z0-9_.:/|+\- ]+$/.test(value)
    ? value
    : JSON.stringify(value);
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

function createLocalRequestProblem(operation: HostOperationDefinition, request: unknown): string | undefined {
  if (operation.key !== "revit.resolve.references" || request == null || typeof request !== "object" || Array.isArray(request))
    return undefined;

  const fields = request as Record<string, unknown>;
  if ("phrases" in fields)
    return "revit.resolve.references accepts one referenceText string, not phrases[].";
  if (!("referenceText" in fields) && !("ReferenceText" in fields))
    return "revit.resolve.references requires referenceText. Use operation metadata for optional filters and examples.";

  return undefined;
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
  return matchesDomainFilter(operation, options.domain)
    && (!options.executionMode || operation.executionMode === options.executionMode)
    && (!options.intent || getOperationIntent(operation) === options.intent)
    && (options.requiresBridge == null || operation.requiresBridge === options.requiresBridge)
    && (options.requiresActiveDocument == null || operation.requiresActiveDocument === options.requiresActiveDocument)
    && (!options.visibility || operation.visibility === options.visibility);
}

function matchesDomainFilter(operation: HostOperationDefinition, domain: string | undefined): boolean {
  if (domain == null || domain.trim().length === 0)
    return true;

  const expected = domain.trim().toLowerCase();
  return [getOperationDomain(operation), ...getOperationDomainAliases(operation)]
    .some((value) => value.toLowerCase() === expected);
}

function getOperationDomain(operation: HostOperationDefinition): string {
  return operation.key.split(".", 1)[0] || "host";
}

function getOperationDomainAliases(operation: HostOperationDefinition): string[] {
  const domain = getOperationDomain(operation);
  if (domain === "scripting")
    return ["script"];
  if (domain === "script")
    return ["scripting"];
  return [];
}

function getOperationIntent(operation: HostOperationDefinition): HostOperationIntent {
  return operation.costTier === "Mutation" ? "Mutate" : "Read";
}

function getRevitLayer(operation: HostOperationDefinition): string | undefined {
  const parts = operation.key.split(".");
  return parts[0] === "revit" ? toTitleCase(parts[1]) : undefined;
}

function getDomainNoun(operation: HostOperationDefinition): string {
  const parts = operation.key.split(".");
  if (parts[0] === "revit" && parts.length >= 3)
    return parts.slice(2).join(".");
  return parts.length > 1 ? parts.slice(1).join(".") : parts[0] ?? operation.key;
}

function toTitleCase(value: string | undefined): string | undefined {
  if (!value)
    return undefined;
  return `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function scoreOperation(operation: HostOperationDefinition, queryTerms: string[]): number {
  if (queryTerms.length === 0)
    return 1;

  const revitLayer = getRevitLayer(operation);
  const domainNoun = getDomainNoun(operation);
  const fields = [
    operation.key,
    operation.displayName,
    getOperationDomain(operation),
    operation.description,
    operation.requestTypeName,
    operation.responseTypeName,
    revitLayer,
    domainNoun,
    operation.costTier,
    operation.singleFlightGroup ?? undefined,
    operation.visibility,
    operation.safeDefaultRequestJson ?? undefined,
    ...(operation.searchTerms ?? []),
    ...(operation.callGuidance ?? []),
    ...(operation.relatedOperations ?? []).flatMap((relatedOperation) => [relatedOperation.key, relatedOperation.kind, relatedOperation.note ?? ""]),
    ...(operation.requestExamples ?? []).flatMap((example) => [example.name, example.description, example.json]),
  ].filter((value): value is string => value != null && value.length !== 0);

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
    if (operation.searchTerms?.some((searchTerm) => searchTerm.toLowerCase().includes(term)))
      score += 2;
  }

  if (operation.visibility === "DefaultVisible")
    score += 2;
  if (operation.visibility === "ExpertOnly" && !queryNamesEscalation(operation, queryTerms))
    score -= 4;
  if (operation.visibility === "EscalationVisible" && !queryNamesEscalation(operation, queryTerms))
    score -= 1;
  if (revitLayer === "Catalog" && queryNamesAny(queryTerms, ["schedule", "schedules", "family", "families", "parameter", "parameters", "binding", "bindings", "browser", "sheet", "sheets", "view", "views"]))
    score += 2;
  if (operation.key === "revit.catalog.schedules" && queryNamesAny(queryTerms, ["missing", "coverage", "covered", "scheduled", "schedules", "rows", "fields"]))
    score += 3;
  if (operation.key === "revit.matrix.schedule-coverage" && queryNamesAny(queryTerms, ["missing", "coverage", "covered", "scheduled", "schedules"]))
    score += 4;
  if ((revitLayer === "Matrix" || revitLayer === "Detail") && queryNamesAny(queryTerms, ["audit", "coverage", "missing", "blank", "default", "row", "rows", "detail", "matrix"]))
    score += 2;
  if (revitLayer === "Detail" && !queryNamesAny(queryTerms, ["row", "rows", "cell", "cells", "detail", "known", "id", "ids"]))
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
    getDomainNoun(operation),
    getRevitLayer(operation),
    ...(operation.searchTerms ?? []),
    ...(operation.relatedOperations ?? []).map((relatedOperation) => relatedOperation.key),
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

function toSearchResult(operation: HostOperationDefinition, verbosity: HostOperationVerbosity): HostOperationSearchResult {
  if (verbosity === "full")
    return toFullSearchResult(operation);

  const hintResult = toHintSearchResult(operation);
  if (verbosity === "hints")
    return hintResult;

  return {
    key: hintResult.key,
    displayName: hintResult.displayName,
    description: hintResult.description,
    safety: hintResult.safety,
    costTier: hintResult.costTier,
    visibility: hintResult.visibility,
    safeDefaultRequestJson: hintResult.safeDefaultRequestJson,
    relatedOperations: hintResult.relatedOperations,
    requestTypeName: hintResult.requestTypeName,
    responseTypeName: hintResult.responseTypeName,
    requestHint: hintResult.requestHint,
    bestRequestExample: hintResult.bestRequestExample,
    usageHint: hintResult.usageHint,
  };
}

function toHintSearchResult(operation: HostOperationDefinition): HostOperationHintResult {
  const requestHint = createRequestHint(operation);
  const bestRequestExample = getBestRequestExample(operation);
  return {
    key: operation.key,
    displayName: operation.displayName ?? operation.key,
    description: operation.description ?? operation.displayName ?? operation.key,
    searchTerms: operation.searchTerms ?? [],
    executionMode: operation.executionMode,
    safety: createSafetySummary(operation),
    costTier: operation.costTier,
    visibility: operation.visibility,
    safeDefaultRequestJson: operation.safeDefaultRequestJson,
    relatedOperations: operation.relatedOperations ?? [],
    singleFlightGroup: operation.singleFlightGroup,
    strictRequestValidation: operation.strictRequestValidation,
    requiresBridge: operation.requiresBridge ?? operation.executionMode === "Bridge",
    requiresActiveDocument: operation.requiresActiveDocument ?? false,
    supportedActiveDocumentKinds: operation.supportedActiveDocumentKinds ?? [],
    requestTypeName: operation.requestTypeName ?? "unknown",
    responseTypeName: operation.responseTypeName ?? "unknown",
    requestHint,
    bestRequestExample,
    usageHint: createUsageHint(operation, bestRequestExample, requestHint),
    callGuidance: operation.callGuidance ?? [],
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

function createSafetySummary(operation: HostOperationDefinition): string {
  return unique([
    operation.executionMode,
    operation.requiresActiveDocument ? "active-doc" : undefined,
    operation.costTier,
    ...(operation.supportedActiveDocumentKinds ?? []),
  ].filter((value): value is string => value != null && value.length !== 0)).join(", ");
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
  if (operation.safeDefaultRequestJson)
    hints.push(`Safe default request: ${operation.safeDefaultRequestJson}`);
  if (operation.strictRequestValidation)
    hints.push("Strict request validation; unknown or nonsensical fields fail instead of silently broadening results.");
  if (getOperationIntent(operation) === "Mutate")
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
