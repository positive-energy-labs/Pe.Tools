/**
 * TanStack Query over the Revit host RPC.
 *
 * `useHostOp` is the whole surface: any operation key (generated or
 * runtime-registered) becomes a query with one call. The named hooks below are
 * one-line conveniences kept for existing routes; new routes can call
 * `useHostOp` directly.
 */
import { useQuery } from "@tanstack/react-query";

import { callHostRpc } from "#/host/client";
import type { LoadedFamiliesMatrixRequest } from "#/host/loaded-families-view";
import type {
  HostOpRequest,
  HostSessionScope,
  OpCallArgs,
  OpKey,
} from "@pe/host-contracts/operation-types";

type FieldOptionsRequest = HostOpRequest<"settings.field-options">;
type ParameterCatalogRequest = HostOpRequest<"settings.parameter-catalog">;

export const HOST_QUERY_KEY = ["pe-host"] as const;

type HostQueryOptions = HostSessionScope & {
  readonly enabled?: boolean;
};

type HostOpQueryTuning = {
  readonly staleTime?: number;
  readonly gcTime?: number;
  readonly refetchOnMount?: boolean;
  readonly refetchOnReconnect?: boolean;
  readonly refetchOnWindowFocus?: boolean;
};

/** Key-order-insensitive serialization so semantically equal requests share a cache entry. */
function stableKey(value: unknown): string {
  return (
    JSON.stringify(value, (_k, v: unknown) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
          )
        : v,
    ) ?? ""
  );
}

export function useHostOp<K extends OpKey>(
  key: K,
  ...args: OpCallArgs<K, HostQueryOptions & HostOpQueryTuning>
) {
  const [request, options] = args;
  const { enabled, bridgeSessionId, ...tuning } = options ?? {};
  const scope = bridgeSessionId ? { bridgeSessionId } : undefined;
  return useQuery({
    queryKey: [...HOST_QUERY_KEY, bridgeSessionId ?? "", key, stableKey(request)],
    // Cast: TS cannot resolve the conditional OpCallArgs tuple while K is open;
    // the public signatures on this hook and callHostRpc enforce it at call sites.
    queryFn: () => callHostRpc(key, ...([request, scope] as OpCallArgs<K, HostSessionScope>)),
    enabled: enabled ?? true,
    refetchOnWindowFocus: false,
    ...tuning,
  });
}

// --- named conveniences ------------------------------------------------------

export function useHostStatusQuery(options?: HostQueryOptions) {
  return useHostOp("host.status", undefined, { ...options, staleTime: 15_000 });
}

export function useBridgeSessionsListQuery(options?: { enabled?: boolean }) {
  return useHostOp("bridge.sessions.list", undefined, { ...options, staleTime: 5_000 });
}

export function useLoadedFamiliesMatrixQuery(
  request: LoadedFamiliesMatrixRequest | undefined,
  options?: HostQueryOptions,
) {
  return useHostOp("revit.matrix.loaded-families", request, {
    ...options,
    enabled: (options?.enabled ?? true) && Boolean(request),
    staleTime: 10_000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
}

export function useFieldOptionsQuery(request: FieldOptionsRequest, options?: HostQueryOptions) {
  return useHostOp("settings.field-options", request, {
    ...options,
    enabled:
      (options?.enabled ?? true) &&
      Boolean(request.moduleKey && request.propertyPath && request.sourceKey),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
  });
}

export function useParameterCatalogQuery(
  request: ParameterCatalogRequest,
  options?: HostQueryOptions,
) {
  return useHostOp("settings.parameter-catalog", request, {
    ...options,
    enabled: (options?.enabled ?? true) && Boolean(request.moduleKey),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
  });
}
