import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HostCallError,
  type HostSessionScope,
  type OpKey,
  type OpRequestOf,
  type OpResponseOf,
} from "@pe/host-contracts/operation-types";

const HOST_CALL_URL = "/pe-host/call";

/**
 * The typed client: POST { key, request } as JSON, keys constrained to the
 * checked-in typegen output + TS-only ops. Errors arrive as problem-JSON with
 * a real HTTP status.
 */
export function callHostRpc<K extends OpKey>(
  key: K,
  request?: OpRequestOf<K>,
  options?: HostSessionScope,
): Promise<OpResponseOf<K>> {
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
  options?: HostSessionScope,
): Promise<unknown> {
  return postCall(key, request, options);
}

async function postCall(
  key: string,
  request: unknown,
  options?: HostSessionScope,
): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options?.bridgeSessionId) headers[HOST_RPC_BRIDGE_SESSION_HEADER] = options.bridgeSessionId;

  const response = await fetch(HOST_CALL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ key, request }),
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
