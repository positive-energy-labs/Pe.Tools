/**
 * TanStack Query hooks over the Revit host RPC. Literal operation keys infer
 * response types from the generated/TS-owned operation contract boundary.
 */
import { useQuery } from "@tanstack/react-query";

import { callHostRpc } from "#/host/client";
import { type LoadedFamiliesRequest, flattenMatrixData } from "#/host/loaded-families-view";
import type {
  FieldOptionsRequest,
  ParameterCatalogRequest,
  SchemaRequest,
} from "@pe/host-contracts/effect";
import type { HostSessionScope, SettingsTreeRequest } from "@pe/host-contracts/operation-types";

const KEY = ["pe-host"] as const;

type HostQueryOptions = HostSessionScope & {
  readonly enabled?: boolean;
};

function sessionKey(options: HostQueryOptions | undefined): string {
  return options?.bridgeSessionId ?? "";
}

function callOptions(options: HostQueryOptions | undefined) {
  return options?.bridgeSessionId ? { bridgeSessionId: options.bridgeSessionId } : undefined;
}

function stableSerialize(input: Record<string, string> | undefined | null): string {
  if (!input) return "{}";
  return JSON.stringify(
    Object.keys(input)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = input[key] ?? "";
        return acc;
      }, {}),
  );
}

function filterKey(request: LoadedFamiliesRequest | undefined): string {
  const f = request?.filter;
  return [
    f?.categoryNames?.join(",") ?? "",
    f?.familyNames?.join(",") ?? "",
    f?.familyNameContains ?? "",
    f?.placementScope ?? "",
  ].join("|");
}

export function useHostStatusQuery(options?: HostQueryOptions) {
  return useQuery({
    queryKey: [...KEY, sessionKey(options), "host-status"],
    queryFn: () => callHostRpc("host.status", undefined, callOptions(options)),
    enabled: options?.enabled ?? true,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function useBridgeSessionSummaryQuery(options?: HostQueryOptions) {
  return useQuery({
    queryKey: [...KEY, sessionKey(options), "bridge-session-summary"],
    queryFn: () => callHostRpc("bridge.sessions.summary", undefined, callOptions(options)),
    enabled: options?.enabled ?? true,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function useBridgeSessionsListQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...KEY, "bridge-sessions-list"],
    queryFn: () => callHostRpc("bridge.sessions.list"),
    enabled: options?.enabled ?? true,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
}

export function useLoadedFamiliesCatalogQuery(
  request: LoadedFamiliesRequest,
  options?: HostQueryOptions,
) {
  return useQuery({
    queryKey: [...KEY, sessionKey(options), "loaded-families-catalog", filterKey(request)],
    queryFn: () => callHostRpc("revit.catalog.loaded-families", request, callOptions(options)),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function useLoadedFamiliesMatrixQuery(
  request: LoadedFamiliesRequest | undefined,
  options?: HostQueryOptions,
) {
  return useQuery({
    queryKey: [...KEY, sessionKey(options), "loaded-families-matrix", filterKey(request)],
    queryFn: async () => {
      if (!request) throw new Error("Loaded families matrix request is required.");
      return flattenMatrixData(
        await callHostRpc("revit.matrix.loaded-families", request, callOptions(options)),
      );
    },
    enabled: (options?.enabled ?? true) && Boolean(request),
    staleTime: 10_000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

// --- settings -------------------------------------------------------------

export function useWorkspacesQuery(options?: HostQueryOptions) {
  return useQuery({
    queryKey: [...KEY, sessionKey(options), "workspaces"],
    queryFn: () => callHostRpc("settings.workspaces", undefined, callOptions(options)),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useTreeQuery(request: SettingsTreeRequest | undefined, options?: HostQueryOptions) {
  return useQuery({
    queryKey: [
      ...KEY,
      sessionKey(options),
      "tree",
      request?.moduleKey ?? "",
      request?.rootKey ?? "",
      request?.subDirectory ?? "",
    ],
    queryFn: () => {
      if (!request) throw new Error("Tree request is required.");
      return callHostRpc("settings.tree", request, callOptions(options));
    },
    enabled: (options?.enabled ?? true) && Boolean(request?.moduleKey && request?.rootKey),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useSchemaQuery(request: SchemaRequest | undefined, options?: HostQueryOptions) {
  return useQuery({
    queryKey: [
      ...KEY,
      sessionKey(options),
      "schema",
      request?.moduleKey ?? "",
      request?.rootKey ?? "",
    ],
    queryFn: () => {
      if (!request) throw new Error("Schema request is required.");
      return callHostRpc("settings.schema", request, callOptions(options));
    },
    enabled: (options?.enabled ?? true) && Boolean(request?.moduleKey && request?.rootKey),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useFieldOptionsQuery(request: FieldOptionsRequest, options?: HostQueryOptions) {
  return useQuery({
    queryKey: [
      ...KEY,
      sessionKey(options),
      "field-options",
      request.moduleKey,
      request.rootKey,
      request.propertyPath,
      request.sourceKey,
      stableSerialize(request.contextValues),
    ],
    queryFn: () => callHostRpc("settings.field-options", request, callOptions(options)),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(request.moduleKey && request.propertyPath && request.sourceKey),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

export function useParameterCatalogQuery(
  request: ParameterCatalogRequest,
  options?: HostQueryOptions,
) {
  return useQuery({
    queryKey: [
      ...KEY,
      sessionKey(options),
      "parameter-catalog",
      request.moduleKey,
      stableSerialize(request.contextValues),
    ],
    queryFn: () => callHostRpc("settings.parameter-catalog", request, callOptions(options)),
    enabled: (options?.enabled ?? true) && Boolean(request.moduleKey),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}
