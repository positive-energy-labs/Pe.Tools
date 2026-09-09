import { Effect } from "effect";
import type { ResolvedTarget } from "@pe/agent-contracts";
import {
  hostProcessIdentity,
  type HostOperationCostTier,
  type HostOperationDefinition,
  type HostOperationNeeds,
  type HostOperationRequestExample,
  type HostOperationVisibility,
} from "@pe/host-contracts/contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
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
// metadata. Cached briefly so per-call enrichment doesn't hit the bridge repeatedly.

type OpsCatalogEntry = HostOperationDefinition & {
  requestSchemaJson?: string;
  responseSchemaJson?: string;
};

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
  // operation in the dev session and then invoke it in another session where that contract does not exist.
  const cacheKey = `${base}\0${bridgeSessionId ?? ""}`;
  const cached = catalogCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.ops;

  const headers: Record<string, string> = {};
  if (bridgeSessionId) headers[HOST_RPC_BRIDGE_SESSION_HEADER] = bridgeSessionId;
  // A transport failure must NAME THE URL: a bare `fetch failed` with the host up was the
  // 2026-08-19/20 dead end — no port, no hint, indistinguishable from a wrong-lane resolution.
  const response = await fetch(`${base}/ops`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  }).catch((error: unknown) => {
    throw new HostCallError(`host.ops.catalog: GET ${base}/ops failed: ${String(error)}`, 0, {
      operationKey: "host.ops.catalog",
      title: String(error),
      status: 0,
    });
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

/** The enrichment row a `/call` receipt carries; the ranked catalog lives in `findCapabilities`. */
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
  needs?: HostOperationNeeds;
};

type HostOperationCallResult =
  | {
      ok: true;
      key: string;
      elapsedMs: number;
      operation?: HostOperationSearchResult;
      /** The session and document the host actually resolved to (x-pe-resolved-* headers). */
      resolvedTarget?: ResolvedTarget;
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

  /** The host this caller resolved — disclosable BEFORE a request, not only in a failure. */
  get hostBaseUrl(): string {
    return this.options.hostBaseUrl;
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
      resolvedTarget: result.success.resolvedTarget,
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
  const call = yield* runHostRpcEffect(key, request, options);
  return {
    status: 200,
    elapsedMs: Math.round(performance.now() - started),
    rawBody: call.body,
    resolvedTarget: call.resolvedTarget,
  };
});

/** Every /call response names the target it ran against; absent headers mean no Revit session. */
function readResolvedTarget(response: Response): ResolvedTarget | undefined {
  const session = response.headers.get("x-pe-resolved-session");
  const document = response.headers.get("x-pe-resolved-document");
  return session || document
    ? { session, document: document ? decodeURIComponent(document) : null }
    : undefined;
}

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
      if (options.openDocumentId) headers[HOST_RPC_DOCUMENT_HEADER] = options.openDocumentId;
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
      return {
        body: (await response.json()) as unknown,
        resolvedTarget: readResolvedTarget(response),
      };
    },
    catch: (error) =>
      error instanceof HostCallError
        ? error
        : // Same rule as the catalog fetch: a transport failure names the URL it tried.
          new HostCallError(`${key}: POST ${base}/call failed: ${String(error)}`, 0, {
            operationKey: key,
            title: String(error),
            status: 0,
          }),
  });
});

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
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
    safety: [operation.needs === "nothing" ? undefined : operation.needs, operation.costTier]
      .filter((value) => value != null)
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
        ? `pe_do key=op:${operation.key}`
        : `pe_do key=op:${operation.key} input=${requestHint}`,
  } satisfies HostOperationSearchResult;

  if (verbosity === "compact") return result;
  return {
    ...result,
    searchTerms: operation.searchTerms ?? [],
    needs: operation.needs,
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

function createFailureNextSteps(
  operation: HostOperationDefinition | undefined,
  error: unknown,
): string[] {
  if (operation == null) return ["Use pe_find to verify the operation key."];
  if (error instanceof HostCallError && error.status === 400)
    return [`Check the JSON request against ${createRequestHint(operation)}.`];
  return [
    "Check pe_find with no query for bridge/session connectivity, then retry with a bounded request.",
  ];
}
