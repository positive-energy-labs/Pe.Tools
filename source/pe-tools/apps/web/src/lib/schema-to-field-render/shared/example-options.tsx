import { useMemo } from "react";
import { useFieldOptionsQuery, useParameterCatalogQuery } from "#/readings";
import type { SchemaNodeRef } from "@pe/schema-core";
import { normalizeFieldOptionMode, readPathValue } from "@pe/schema-core";
import type {
  FieldOptionItem,
  FieldOptionState,
  FieldOptionsRequest,
  FieldRendererProps,
  ParameterCatalogEntry,
  RemoteOptionsHook,
} from "./field-option";
import {
  buildContextValues,
  toLocalItems,
  useSchemaDocument,
  useSchemaRenderContext,
} from "./field-option";

export function toLocalItemsFromExamples(values: unknown[]): FieldOptionItem[] {
  return toLocalItems(
    values.flatMap((value) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return [String(value)];
      }

      return [];
    }),
  );
}

export function parseDelimitedContextValues(value: string | undefined): string[] {
  return (
    value
      ?.split("|")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );
}

export function projectFamilyParameterCatalogValues(
  entries: readonly ParameterCatalogEntry[],
  contextValues: Record<string, string>,
): string[] {
  const selectedFamilyNames = parseDelimitedContextValues(contextValues.SelectedFamilyNames);
  if (selectedFamilyNames.length === 0) {
    return entries.map((entry) => entry.definition.identity.name);
  }

  const selectedFamilies = new Set(selectedFamilyNames);
  return entries
    .filter((entry) => entry.familyNames.some((familyName) => selectedFamilies.has(familyName)))
    .map((entry) => entry.definition.identity.name);
}

export function projectParameterCatalogItems(
  entries: readonly ParameterCatalogEntry[],
  sourceKey: string,
  contextValues: Record<string, string>,
): FieldOptionItem[] {
  const projectedValues =
    sourceKey === "FamilyParameterNamesProvider"
      ? projectFamilyParameterCatalogValues(entries, contextValues)
      : entries.map((entry) => entry.definition.identity.name);

  const dedupedValues = Array.from(new Set(projectedValues)).sort((a, b) => a.localeCompare(b));
  return toLocalItems(dedupedValues);
}

const useSettingsRemoteOptions: RemoteOptionsHook = (request, enabled) =>
  useFieldOptionsQuery(request, { enabled });

export function useFieldOptions({
  node,
  providerNode,
  fieldPath,
}: {
  node: SchemaNodeRef;
  providerNode?: SchemaNodeRef;
  fieldPath: string;
}) {
  const { moduleKey, rootKey, values: allValues, useRemoteOptions } = useSchemaRenderContext();
  const useRemote = useRemoteOptions ?? useSettingsRemoteOptions;
  const effectiveProviderNode = providerNode ?? node;
  const requestPath = effectiveProviderNode.providerPath();
  const remoteSource = useMemo(() => effectiveProviderNode.optionSource(), [effectiveProviderNode]);
  const request = useMemo<FieldOptionsRequest>(() => {
    return {
      moduleKey,
      rootKey: rootKey ?? "",
      propertyPath: requestPath,
      sourceKey: remoteSource?.key ?? "",
      contextValues: buildContextValues(remoteSource?.dependsOn ?? [], fieldPath, allValues),
    };
  }, [allValues, fieldPath, moduleKey, remoteSource, requestPath, rootKey]);
  const contextValues = request.contextValues ?? {};
  const dependencyStates = useMemo(
    () =>
      (remoteSource?.dependsOn ?? []).map((dependency) => ({
        ...dependency,
        value: contextValues[dependency.key],
      })),
    [contextValues, remoteSource?.dependsOn],
  );
  const resolver = remoteSource?.resolver;
  const dataset = remoteSource?.dataset;
  const usesRemoteResolver = resolver === "remote";
  const usesParameterCatalogDataset = resolver === "dataset" && dataset === "parametercatalog";
  const remoteQuery = useRemote(request, usesRemoteResolver);
  const parameterCatalogQuery = useParameterCatalogQuery(
    { moduleKey, contextValues },
    { enabled: usesParameterCatalogDataset },
  );
  const enumItems = useMemo(() => {
    const rawNode = node.raw();
    return Array.isArray(rawNode.enum)
      ? toLocalItems(rawNode.enum.map((value) => String(value)))
      : [];
  }, [node]);
  const inlineItems = useMemo(() => {
    const rawNode = node.raw();
    return Array.isArray(rawNode.examples) ? toLocalItemsFromExamples(rawNode.examples) : [];
  }, [node]);
  const datasetItems = useMemo(() => {
    if (!usesParameterCatalogDataset || !remoteSource) {
      return [] as FieldOptionItem[];
    }

    const entries = parameterCatalogQuery.data?.entries ?? [];
    return projectParameterCatalogItems(entries, remoteSource.key, contextValues);
  }, [
    contextValues,
    parameterCatalogQuery.data?.entries,
    remoteSource,
    usesParameterCatalogDataset,
  ]);

  function createState(
    state: Omit<FieldOptionState, "contextValues" | "dependencies" | "requestPath">,
  ): FieldOptionState {
    return {
      ...state,
      requestPath,
      dependencies: dependencyStates,
      contextValues,
    };
  }

  if (enumItems.length > 0) {
    return createState({
      items: enumItems,
      mode: "constraint",
      allowsCustomValue: false,
      isLoading: false,
      source: "enum",
    });
  }

  const remoteItems = remoteQuery.data?.items ?? [];
  if (usesRemoteResolver && remoteItems.length > 0 && remoteSource) {
    return createState({
      items: remoteItems,
      mode: normalizeFieldOptionMode(remoteQuery.data?.mode) ?? remoteSource.mode,
      allowsCustomValue: remoteQuery.data?.allowsCustomValue ?? remoteSource.allowsCustomValue,
      isLoading: false,
      errorMessage: undefined,
      source: "remote",
      sourceKey: remoteSource.key,
      resolver: remoteSource.resolver,
      dataset: remoteSource.dataset,
    });
  }

  if (usesParameterCatalogDataset && datasetItems.length > 0 && remoteSource) {
    return createState({
      items: datasetItems,
      mode: remoteSource.mode,
      allowsCustomValue: remoteSource.allowsCustomValue,
      isLoading: false,
      errorMessage: undefined,
      source: "dataset",
      sourceKey: remoteSource.key,
      resolver: remoteSource.resolver,
      dataset: remoteSource.dataset,
    });
  }

  if (usesRemoteResolver && remoteSource && (remoteQuery.isPending || remoteQuery.pending)) {
    return createState({
      items: [] as FieldOptionItem[],
      mode: remoteSource.mode,
      allowsCustomValue: remoteSource.allowsCustomValue,
      isLoading: true,
      errorMessage: undefined,
      source: "remote",
      sourceKey: remoteSource.key,
      resolver: remoteSource.resolver,
      dataset: remoteSource.dataset,
    });
  }

  if (
    usesParameterCatalogDataset &&
    remoteSource &&
    (parameterCatalogQuery.isPending || parameterCatalogQuery.pending)
  ) {
    return createState({
      items: [] as FieldOptionItem[],
      mode: remoteSource.mode,
      allowsCustomValue: remoteSource.allowsCustomValue,
      isLoading: true,
      errorMessage: undefined,
      source: "dataset",
      sourceKey: remoteSource.key,
      resolver: remoteSource.resolver,
      dataset: remoteSource.dataset,
    });
  }

  const remoteErrorMessage =
    usesRemoteResolver && remoteQuery.error instanceof Error
      ? remoteQuery.error.message
      : usesParameterCatalogDataset && parameterCatalogQuery.error instanceof Error
        ? parameterCatalogQuery.error.message
        : undefined;

  return createState({
    items: inlineItems,
    mode: remoteSource?.mode ?? "suggestion",
    allowsCustomValue: remoteSource?.allowsCustomValue ?? true,
    isLoading: false,
    errorMessage: remoteErrorMessage,
    source: remoteSource
      ? usesParameterCatalogDataset
        ? "dataset"
        : "remote"
      : inlineItems.length > 0
        ? "examples"
        : "none",
    sourceKey: remoteSource?.key,
    resolver: remoteSource?.resolver,
    dataset: remoteSource?.dataset,
  });
}

export function useResolvedFieldNode({ node, path }: FieldRendererProps) {
  const { values: allValues } = useSchemaRenderContext();
  const schemaDocument = useSchemaDocument();
  const effectiveNodeRef = useMemo(() => {
    const pathResolved = schemaDocument.resolveAt(path, allValues);
    if (pathResolved) {
      return pathResolved;
    }

    const rawNodeRef = schemaDocument.ref(path, node);
    return rawNodeRef.effective(readPathValue(allValues, path));
  }, [allValues, node, path, schemaDocument]);
  const effectiveNode = effectiveNodeRef.raw();
  const nodeType = effectiveNodeRef.kind();
  const label = effectiveNodeRef.label();
  const placeholder = effectiveNodeRef.placeholder();
  const isRequired = effectiveNodeRef.isRequired();

  return {
    effectiveNode,
    effectiveNodeRef,
    isRequired,
    label,
    nodeType,
    placeholder,
  };
}
