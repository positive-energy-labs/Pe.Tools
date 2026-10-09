import {
  HOST_RPC_SDK_SESSION_HEADER,
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
  HostCallError,
  type HostSessionScope,
  type OpCallArgs,
  type OpKey,
  type OpResponseOf,
} from "@pe/host-contracts/operation-types";
export type HostCallOptions = HostSessionScope & { signal?: AbortSignal; baseURL?: string };

/** A host-relative path on the base host calls use (the page's origin, proxied in dev). */
export const hostUrl = (path: string, baseURL = "") => `${baseURL}${path}`;

/**
 * The typed client: POST { key, request } as JSON, keys constrained to the
 * checked-in typegen output + TS-only ops. Errors arrive as problem-JSON with
 * a real HTTP status.
 */
export function callHostRpc<K extends OpKey>(
  key: K,
  ...args: OpCallArgs<K, HostCallOptions>
): Promise<OpResponseOf<K>> {
  const [request, options] = args;
  return postCall(key, request, options) as Promise<OpResponseOf<K>>;
}

/**
 * Escape hatch for runtime-registered ops the checked-in types haven't caught
 * up with (fresh C# op before `host-typegen` is re-run). Untyped by design —
 * regenerate and switch to `callHostRpc` once the op is stable.
 */
export function callHostDynamic(
  key: string,
  request?: unknown,
  options?: HostCallOptions,
): Promise<unknown> {
  return postCall(key, request, options);
}

async function postCall(
  key: string,
  request: unknown,
  options?: HostCallOptions,
): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options?.session) headers[HOST_RPC_SDK_SESSION_HEADER] = JSON.stringify(options.session);
  if (options?.bridgeSessionId) headers[HOST_RPC_BRIDGE_SESSION_HEADER] = options.bridgeSessionId;
  if (options?.openDocumentId) headers[HOST_RPC_DOCUMENT_HEADER] = options.openDocumentId;
  // queue-provenance §1: `web:<route>` — the current path is the route id at call time.
  headers[HOST_RPC_ORIGIN_HEADER] = `web:${window.location.pathname}`;

  const response = await fetch(hostUrl("/call", options?.baseURL), {
    method: "POST",
    headers,
    body: JSON.stringify({ key, request }),
    signal: options?.signal,
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => undefined)) as
      | { kind?: string; message?: string; status?: number }
      | undefined;
    throw new HostCallError(`${key}: ${problem?.message ?? response.statusText}`, response.status, {
      kind: problem?.kind,
      operationKey: key,
      title: problem?.message ?? response.statusText,
      status: response.status,
    });
  }
  return response.json();
}
