/**
 * TanStack Query over the Revit host RPC.
 *
 * `useHostOp` is the whole surface: any operation key (generated or
 * runtime-registered) becomes a query with one call. The named hooks below are
 * one-line conveniences kept for existing routes; new routes can call
 * `useHostOp` directly.
 */
import { useQuery } from "@tanstack/react-query";

import { callHostDynamic, callHostRpc } from "#/host/client";
import type {
  LoadedFamiliesMatrixRequest,
  LoadedFamiliesRequest,
} from "#/host/loaded-families-view";
import type {
  HostOpRequest,
  HostSessionScope,
  OpKey,
  OpRequestOf,
  SettingsTreeRequest,
} from "@pe/host-contracts/operation-types";

type FieldOptionsRequest = HostOpRequest<"settings.field-options">;
type ParameterCatalogRequest = HostOpRequest<"settings.parameter-catalog">;
type SchemaRequest = HostOpRequest<"settings.schema">;

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
  request?: OpRequestOf<K>,
  options?: HostQueryOptions & HostOpQueryTuning,
) {
  const { enabled, bridgeSessionId, ...tuning } = options ?? {};
  const scope = bridgeSessionId ? { bridgeSessionId } : undefined;
  return useQuery({
    queryKey: [...HOST_QUERY_KEY, bridgeSessionId ?? "", key, stableKey(request)],
    queryFn: () => callHostRpc(key, request, scope),
    enabled: enabled ?? true,
    refetchOnWindowFocus: false,
    ...tuning,
  });
}

/**
 * Untyped escape hatch for runtime-registered ops the checked-in types haven't
 * caught up with. Regenerate (`host-typegen`) and switch to `useHostOp` once
 * the op is stable.
 */
export function useHostOpDynamic(
  key: string,
  request?: unknown,
  options?: HostQueryOptions & HostOpQueryTuning,
) {
  const { enabled, bridgeSessionId, ...tuning } = options ?? {};
  const scope = bridgeSessionId ? { bridgeSessionId } : undefined;
  return useQuery({
    queryKey: [...HOST_QUERY_KEY, bridgeSessionId ?? "", key, stableKey(request)],
    queryFn: () => callHostDynamic(key, request, scope),
    enabled: enabled ?? true,
    refetchOnWindowFocus: false,
    ...tuning,
  });
}

// --- named conveniences ------------------------------------------------------

export function useHostStatusQuery(options?: HostQueryOptions) {
  return useHostOp("host.status", undefined, { ...options, staleTime: 15_000 });
}

export function useBridgeSessionSummaryQuery(options?: HostQueryOptions) {
  return useHostOp("bridge.sessions.summary", undefined, { ...options, staleTime: 15_000 });
}

export function useBridgeSessionsListQuery(options?: { enabled?: boolean }) {
  return useHostOp("bridge.sessions.list", undefined, { ...options, staleTime: 5_000 });
}

export function useLoadedFamiliesCatalogQuery(
  request: LoadedFamiliesRequest,
  options?: HostQueryOptions,
) {
  return useHostOp("revit.catalog.loaded-families", request, {
    ...options,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
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

// --- settings -----------------------------------------------------------------

export function useWorkspacesQuery(options?: HostQueryOptions) {
  return useHostOp("settings.workspaces", undefined, { ...options, staleTime: 5 * 60 * 1000 });
}

export function useTreeQuery(request: SettingsTreeRequest | undefined, options?: HostQueryOptions) {
  return useHostOp("settings.tree", request, {
    ...options,
    enabled: (options?.enabled ?? true) && Boolean(request?.moduleKey && request?.rootKey),
    staleTime: 60_000,
  });
}

export function useSchemaQuery(request: SchemaRequest | undefined, options?: HostQueryOptions) {
  return useHostOp("settings.schema", request, {
    ...options,
    enabled: (options?.enabled ?? true) && Boolean(request?.moduleKey && request?.rootKey),
    staleTime: 5 * 60 * 1000,
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
