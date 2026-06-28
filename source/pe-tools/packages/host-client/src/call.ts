/**
 * Shared, runtime-agnostic caller for Pe.Host operations.
 *
 * No Node imports — browser and Node both use this. Resolves verb+route from the
 * generated `hostOperations` catalog and request/response schemas from the
 * generated `hostOperationSchemas` registry, so the response type is inferred
 * from the operation key alone and both sides validate with the C#-reflected zod
 * schemas. Pass `baseUrl` to point at a host process (Node) or a dev proxy
 * (browser, e.g. `/pe-host`).
 */
import { hostOperations } from "@pe/host-generated/contracts";
import type { HostOperationDefinition, HostOperationKey } from "@pe/host-generated/contracts";
import { hostOperationSchemas } from "@pe/host-generated/zod/registry";
import type { z } from "zod";

type SchemaRegistry = typeof hostOperationSchemas;

/** Response type for an operation, inferred from its generated response schema. */
export type HostOpResponse<K extends HostOperationKey> = K extends keyof SchemaRegistry
  ? SchemaRegistry[K] extends { response: infer R extends z.ZodType }
    ? z.infer<R>
    : unknown
  : unknown;

/** RFC7807-ish problem body the host returns on failure (extensions are flattened in). */
export interface HostProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

export interface HostCallOptions {
  /** Prepended to the operation route. "" = same-origin; "/pe-host" = dev proxy; full URL = Node. */
  baseUrl?: string;
  fetch?: typeof fetch;
  requestId?: string;
  timeoutMs?: number;
}

export class HostCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly problem?: HostProblemDetails,
  ) {
    super(message);
    this.name = "HostCallError";
  }
}

export interface HostCallResult<K extends HostOperationKey> {
  status: number;
  elapsedMs: number;
  rawBody: unknown;
  data: HostOpResponse<K>;
}

function isRecord(value: unknown): value is HostProblemDetails {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function entryFor(
  key: HostOperationKey,
): { request?: z.ZodType; response?: z.ZodType } | undefined {
  return (hostOperationSchemas as Record<string, { request?: z.ZodType; response?: z.ZodType }>)[
    key
  ];
}

function buildUrl(op: HostOperationDefinition, request: unknown, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  let route = `${base}${op.route}`;
  if (op.verb !== "GET" || request == null) return route;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request as Record<string, unknown>)) {
    if (value == null) continue;
    params.set(
      key,
      typeof value === "object"
        ? JSON.stringify(value)
        : String(value as string | number | boolean),
    );
  }
  const query = params.toString();
  if (query) route += `${route.includes("?") ? "&" : "?"}${query}`;
  return route;
}

/**
 * Transport only: send a request, parse the body, throw `HostCallError` on a
 * non-2xx response. Does not validate against the schema registry — callers that
 * want typed, validated data use `callHostOp` / `callHostOpDetailed`.
 */
export async function sendHostRequest(
  op: HostOperationDefinition,
  request: unknown,
  options: HostCallOptions = {},
): Promise<{ status: number; elapsedMs: number; rawBody: unknown }> {
  const fetchImpl = options.fetch ?? fetch;
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method: op.verb, headers };
  if (op.verb !== "GET") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(request ?? {});
  }
  if (options.requestId) headers["X-Pe-Request-Id"] = options.requestId;

  const controller = options.timeoutMs == null ? undefined : new AbortController();
  if (controller) init.signal = controller.signal;
  const timer = controller
    ? setTimeout(() => controller.abort(), Math.max(options.timeoutMs ?? 0, 1))
    : undefined;

  const started = performance.now();
  let response: Response;
  try {
    response = await fetchImpl(buildUrl(op, request, options.baseUrl ?? ""), init);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const elapsedMs = Math.round(performance.now() - started);

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const problem = isRecord(body) ? body : undefined;
    const detail =
      problem?.detail ??
      problem?.title ??
      (typeof body === "string" && body ? body : `${response.status} ${response.statusText}`);
    throw new HostCallError(`${op.key}: ${detail}`, response.status, problem);
  }

  return { status: response.status, elapsedMs, rawBody: body };
}

/**
 * Call a host operation by key. Validates the request (if a schema exists) before
 * sending and the response after, both with the generated zod schemas. Throws
 * `HostCallError` on a non-2xx response or a shape mismatch.
 */
export async function callHostOpDetailed<K extends HostOperationKey>(
  key: K,
  request?: unknown,
  options?: HostCallOptions,
): Promise<HostCallResult<K>> {
  const op = hostOperations[key];
  const schemas = entryFor(key);

  // Validate as a fail-fast gate only; send the ORIGINAL request. Generated
  // object schemas strip unknown keys, so sending parsed.data would silently
  // drop typo'd fields — the host runs strict unknown-property validation and
  // should be the one to reject them.
  if (schemas?.request && request !== undefined) {
    const parsed = schemas.request.safeParse(request);
    if (!parsed.success)
      throw new HostCallError(`${op.key} request is invalid: ${parsed.error.message}`, 0, {
        operationKey: op.key,
        request,
        issues: parsed.error.issues,
      });
  }

  const { status, elapsedMs, rawBody } = await sendHostRequest(op, request, options);

  if (!schemas?.response) return { status, elapsedMs, rawBody, data: rawBody as HostOpResponse<K> };

  const parsed = schemas.response.safeParse(rawBody);
  if (!parsed.success)
    throw new HostCallError(
      `${op.key} returned an unexpected shape: ${parsed.error.message}`,
      status,
      {
        operationKey: op.key,
        response: rawBody,
        issues: parsed.error.issues,
      },
    );

  return { status, elapsedMs, rawBody, data: parsed.data as HostOpResponse<K> };
}

export async function callHostOp<K extends HostOperationKey>(
  key: K,
  request?: unknown,
  options?: HostCallOptions,
): Promise<HostOpResponse<K>> {
  return (await callHostOpDetailed(key, request, options)).data;
}
