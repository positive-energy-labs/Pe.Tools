export type HostHttpVerb = "GET" | "POST";
export type HostExecutionMode = "Local" | "Bridge";

export interface HostOperationDefinition {
  key: string;
  verb: HostHttpVerb;
  route: string;
  executionMode: HostExecutionMode;
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
  const response = await fetchImpl(`${trimTrailingSlash(options.baseUrl)}${route}`, {
    method: operation.verb,
    headers: operation.verb === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: operation.verb === "POST" ? JSON.stringify(request) : undefined,
  });

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
