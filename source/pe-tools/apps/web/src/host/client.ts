/**
 * Browser-side caller for Pe.Host operations.
 *
 * The caller itself is the runtime-agnostic `@pe/host-client/call` (shared with
 * the Node client); this only binds it to the `/pe-host` dev proxy (see
 * vite.config.ts). Verb+route and request/response validation come from the
 * generated catalog + zod registry, so the response type is inferred from the
 * operation key alone.
 */
import { callHostOp as call, callHostOpDetailed as callDetailed } from "@pe/host-client/call";
import type { HostOperationKey } from "@pe/host-generated/contracts";

export { HostCallError } from "@pe/host-client/call";
export type { HostCallResult, HostOpResponse, HostProblemDetails } from "@pe/host-client/call";

const HOST_PROXY_BASE = "/pe-host";

export function callHostOpDetailed<K extends HostOperationKey>(key: K, request?: unknown) {
  return callDetailed(key, request, { baseUrl: HOST_PROXY_BASE });
}

export function callHostOp<K extends HostOperationKey>(key: K, request?: unknown) {
  return call(key, request, { baseUrl: HOST_PROXY_BASE });
}
