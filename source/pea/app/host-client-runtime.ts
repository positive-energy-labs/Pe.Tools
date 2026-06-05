export type HostHttpVerb = "GET" | "POST";
export type HostExecutionMode = "Local" | "Bridge";
export type HostOperationExposure = "PublicHttp" | "InternalHostOnly";
export type HostOperationIntent = "Read" | "Mutate";
export type HostOperationFamily = "Host" | "Settings" | "Script" | "Revit" | "Aps";
export type RevitOperationLayer = "Context" | "Catalog" | "Matrix" | "Detail" | "Resolve" | "Apply";
export type RevitActiveDocumentKind = "Project" | "Family";
export type HostOperationCostTier = "Cheap" | "Bounded" | "Expensive" | "Mutation";
export type HostOperationVisibility = "DefaultVisible" | "EscalationVisible" | "ExpertOnly";
export type HostOperationRelationKind = "Preflight" | "DrillDown" | "Fallback" | "Alternative";

export interface HostTypeShapeField {
  name: string;
  type: string;
  required: boolean;
}

export interface HostOperationRequestExample {
  name: string;
  description: string;
  json: string;
}

export interface HostOperationRelatedOperation {
  key: string;
  kind: HostOperationRelationKind;
  note?: string | null;
}

export interface HostOperationDefinition {
  key: string;
  verb: HostHttpVerb;
  route: string;
  executionMode: HostExecutionMode;
  exposure?: HostOperationExposure;
  requestTypeName?: string;
  responseTypeName?: string;
  requestShape?: readonly HostTypeShapeField[];
  responseShape?: readonly HostTypeShapeField[];
  displayName?: string;
  description?: string;
  searchTerms?: readonly string[];
  requiresBridge?: boolean;
  requiresActiveDocument?: boolean;
  supportedActiveDocumentKinds?: readonly RevitActiveDocumentKind[];
  costTier?: HostOperationCostTier;
  visibility?: HostOperationVisibility;
  singleFlightGroup?: string | null;
  requestExamples?: readonly HostOperationRequestExample[];
  safeDefaultRequestJson?: string | null;
  callGuidance?: readonly string[];
  relatedOperations?: readonly HostOperationRelatedOperation[];
  strictRequestValidation?: boolean;
}

export interface HostCapabilityMapRow {
  key: string;
  area: string;
  description: string;
  safety: string;
  input: string;
  output: string;
  relations: string;
  terms: string;
}

export interface HostCapabilityMapSection {
  id: string;
  title: string;
  summary: string;
  rows: readonly HostCapabilityMapRow[];
}

export interface HostCapabilityMap {
  generatedFrom: string;
  formatVersion: number;
  rowCount: number;
  guidance: string;
  operationKeys: readonly string[];
  sections: readonly HostCapabilityMapSection[];
  focusSections: readonly HostCapabilityMapSection[];
}

export interface HostProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

export interface PeHostClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  requestId?: string;
  timeoutMs?: number;
}

export class PeHostClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly problem?: HostProblemDetails,
  ) {
    super(message);
    this.name = "PeHostClientError";
  }
}

export async function sendJson<TRequest, TResponse>(
  options: PeHostClientOptions,
  operation: HostOperationDefinition,
  request?: TRequest,
): Promise<TResponse> {
  const fetchImpl = options.fetch ?? fetch;
  const route = operation.verb === "GET"
    ? appendQueryString(operation.route, request)
    : operation.route;
  const headers = new Headers();
  let hasHeaders = false;
  if (operation.verb === "POST") {
    headers.set("Content-Type", "application/json");
    hasHeaders = true;
  }
  if (options.requestId) {
    headers.set("X-Pe-Request-Id", options.requestId);
    hasHeaders = true;
  }

  const controller = options.timeoutMs == null ? undefined : new AbortController();
  const timeout = controller == null
    ? undefined
    : setTimeout(() => controller.abort(), Math.max(options.timeoutMs ?? 0, 1));

  let response: Response;
  try {
    response = await fetchImpl(`${trimTrailingSlash(options.baseUrl)}${route}`, {
      method: operation.verb,
      headers: hasHeaders ? headers : undefined,
      body: operation.verb === "POST" ? JSON.stringify(request) : undefined,
      signal: controller?.signal,
    });
  } finally {
    if (timeout != null)
      clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    const problem = parseJson<HostProblemDetails>(text);
    throw new PeHostClientError(
      problem?.detail ?? problem?.title ?? (text || `${response.status} ${response.statusText}`),
      response.status,
      problem,
    );
  }

  return text ? JSON.parse(text) as TResponse : undefined as TResponse;
}

function appendQueryString<TRequest>(route: string, request?: TRequest): string {
  if (!request)
    return route;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request)) {
    if (value != null)
      params.set(key, String(value));
  }

  const query = params.toString();
  if (!query)
    return route;

  return `${route}${route.includes("?") ? "&" : "?"}${query}`;
}

function parseJson<T>(text: string): T | undefined {
  if (!text)
    return undefined;

  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
