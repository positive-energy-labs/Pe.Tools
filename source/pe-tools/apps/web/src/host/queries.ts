/**
 * TanStack Query hooks over the Revit host. Each hook calls a generated
 * operation by key; `callHostOp` infers the response type from the generated
 * schema registry and validates at the boundary — no hand-passed schemas.
 */
import { useQuery } from "@tanstack/react-query";

import { callHostOp } from "#/host/client";
import { type LoadedFamiliesRequest, flattenMatrixData } from "#/host/contracts";
import type {
  FieldOptionsRequest,
  ParameterCatalogRequest,
  SchemaRequest,
  SettingsTreeRequest,
} from "#/host/settings-contracts";

const KEY = ["pe-host"] as const;

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

export function useHostProbeQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...KEY, "host-probe"],
    queryFn: () => callHostOp("settings.host-probe"),
    enabled: options?.enabled ?? true,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function useSessionSummaryQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...KEY, "session-summary"],
    queryFn: () => callHostOp("settings.session-summary"),
    enabled: options?.enabled ?? true,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function useLoadedFamiliesCatalogQuery(
  request: LoadedFamiliesRequest,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [...KEY, "loaded-families-catalog", filterKey(request)],
    queryFn: () => callHostOp("revit.catalog.loaded-families", request),
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
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [...KEY, "loaded-families-matrix", filterKey(request)],
    queryFn: async () => {
      if (!request) throw new Error("Loaded families matrix request is required.");
      return flattenMatrixData(await callHostOp("revit.matrix.loaded-families", request));
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

export function useWorkspacesQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...KEY, "workspaces"],
    queryFn: () => callHostOp("settings.workspaces", {}),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useTreeQuery(
  request: SettingsTreeRequest | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [
      ...KEY,
      "tree",
      request?.moduleKey ?? "",
      request?.rootKey ?? "",
      request?.subDirectory ?? "",
    ],
    queryFn: () => {
      if (!request) throw new Error("Tree request is required.");
      return callHostOp("settings.tree", request);
    },
    enabled: (options?.enabled ?? true) && Boolean(request?.moduleKey && request?.rootKey),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useSchemaQuery(
  request: SchemaRequest | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [...KEY, "schema", request?.moduleKey ?? "", request?.rootKey ?? ""],
    queryFn: () => {
      if (!request) throw new Error("Schema request is required.");
      return callHostOp("settings.schema", request);
    },
    enabled: (options?.enabled ?? true) && Boolean(request?.moduleKey && request?.rootKey),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useFieldOptionsQuery(
  request: FieldOptionsRequest,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [
      ...KEY,
      "field-options",
      request.moduleKey,
      request.rootKey,
      request.propertyPath,
      request.sourceKey,
      stableSerialize(request.contextValues),
    ],
    queryFn: () => callHostOp("settings.field-options", request),
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
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [
      ...KEY,
      "parameter-catalog",
      request.moduleKey,
      stableSerialize(request.contextValues),
    ],
    queryFn: () => callHostOp("settings.parameter-catalog", request),
    enabled: (options?.enabled ?? true) && Boolean(request.moduleKey),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}
