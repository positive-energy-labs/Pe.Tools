import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SettingsFieldOptions, SettingsParameterCatalog } from "@pe/host-contracts/generated";

type FieldOptionItem = SettingsFieldOptions.Res.FieldOptionItem;
type FieldOptionsRequest = SettingsFieldOptions.Req.Request;
type ParameterCatalogEntry = SettingsParameterCatalog.Res.ParameterCatalogEntry;
import type { SettingsValidationResult } from "@pe/host-contracts/operation-types";
import { useFieldOptionsQuery, useParameterCatalogQuery } from "#/host/queries";
import type {
  NormalizedRenderFieldOptionDependency,
  RenderSchemaNode,
  SchemaNodeRef,
} from "@pe/schema-core";
import {
  getFieldOrder,
  normalizeFieldOptionMode,
  readPathValue,
  type SchemaDocument,
} from "@pe/schema-core";
import type { FieldChangeSummary } from "./field-state";

export type SettingsValues = Record<string, unknown>;

export interface SchemaToFieldRenderProps {
  values: SettingsValues;
  onChange: (path: string, value: unknown) => void;
  schema: RenderSchemaNode;
  moduleKey: string;
  rootKey?: string;
  baselineValues: SettingsValues;
  validationResult?: SettingsValidationResult;
}

export interface FieldRendererProps {
  path: string;
  node: RenderSchemaNode;
}

export interface FieldOptionDependencyState extends NormalizedRenderFieldOptionDependency {
  value?: string;
}

export interface FieldOptionState {
  items: readonly FieldOptionItem[];
  mode: "suggestion" | "constraint";
  allowsCustomValue: boolean;
  isLoading: boolean;
  errorMessage?: string;
  source: "enum" | "examples" | "remote" | "dataset" | "none";
  sourceKey?: string;
  resolver?: "remote" | "dataset";
  dataset?: string;
  requestPath?: string;
  dependencies: FieldOptionDependencyState[];
  contextValues: Record<string, string>;
}

export interface ResolvedFieldRendererProps extends FieldRendererProps {
  effectiveNode: RenderSchemaNode;
  effectiveNodeRef: SchemaNodeRef;
  nodeType: string | undefined;
  label: string;
  isRequired: boolean;
  placeholder?: string;
}

interface SchemaRenderContextValue {
  values: SettingsValues;
  onChange: (path: string, value: unknown) => void;
  errors: ReadonlyMap<string, string[]>;
  moduleKey: string;
  rootKey?: string;
  schemaDocument: SchemaDocument;
  fieldChanges: ReadonlyMap<string, FieldChangeSummary>;
}

const SchemaRenderContext = createContext<SchemaRenderContextValue | null>(null);

export function SchemaRenderProvider({
  values,
  onChange,
  errors,
  schemaDocument,
  moduleKey,
  rootKey,
  fieldChanges,
  children,
}: {
  values: SettingsValues;
  onChange: (path: string, value: unknown) => void;
  errors: ReadonlyMap<string, string[]>;
  schemaDocument: SchemaDocument;
  moduleKey: string;
  rootKey?: string;
  fieldChanges: ReadonlyMap<string, FieldChangeSummary>;
  children: ReactNode;
}) {
  const contextValue = useMemo(
    () => ({
      values,
      onChange,
      errors,
      moduleKey,
      rootKey,
      schemaDocument,
      fieldChanges,
    }),
    [errors, fieldChanges, moduleKey, onChange, rootKey, schemaDocument, values],
  );

  return (
    <SchemaRenderContext.Provider value={contextValue}>{children}</SchemaRenderContext.Provider>
  );
}

function useSchemaRenderContext() {
  const context = useContext(SchemaRenderContext);
  if (!context) {
    throw new Error("Schema render context is not available.");
  }

  return context;
}

export function useSettingsField(path: string) {
  const { values, onChange, errors } = useSchemaRenderContext();
  const value = readPathValue(values, path);
  return {
    value,
    errors: errors.get(path) ?? [],
    change: (next: unknown) => onChange(path, next),
    push: (next: unknown) => onChange(path, [...(Array.isArray(value) ? value : []), next]),
    remove: (index: number) =>
      onChange(path, (Array.isArray(value) ? value : []).filter((_, at) => at !== index)),
  };
}

export function useSchemaRoot() {
  return useSchemaDocument().rawRoot();
}

export function useSchemaDocument() {
  return useSchemaRenderContext().schemaDocument;
}

export function useFieldChangeSummary(path: string) {
  return useSchemaRenderContext().fieldChanges.get(path);
}

export function coercePrimitive(input: string, nodeType: string | undefined): unknown {
  if (nodeType === "integer" || nodeType === "number") {
    const parsed = Number(input);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (nodeType === "boolean") {
    return input === "true";
  }

  return input;
}

export function objectEntriesSorted(
  properties: Record<string, RenderSchemaNode>,
): Array<[string, RenderSchemaNode]> {
  return Object.entries(properties).sort(([aKey, aNode], [bKey, bNode]) => {
    const aOrder = Number(getFieldOrder(aNode) ?? 10_000);
    const bOrder = Number(getFieldOrder(bNode) ?? 10_000);

    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    return aKey.localeCompare(bKey);
  });
}

export function buildDefaultArrayItem(itemNode: SchemaNodeRef | undefined) {
  return itemNode?.defaultValue() ?? {};
}

function serializeContextValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const normalized = value.map((entry) => String(entry).trim()).filter(Boolean);
    return normalized.length > 0 ? normalized.join("|") : undefined;
  }

  return JSON.stringify(value);
}

function getParentObjectPath(fieldPath: string) {
  const parts = fieldPath.split(".");
  parts.pop();
  return parts.join(".");
}

function resolveContextDependencyValue(
  dependency: NormalizedRenderFieldOptionDependency,
  fieldPath: string,
  allValues: SettingsValues,
): unknown {
  if (dependency.scope === "sibling") {
    const parentObjectPath = getParentObjectPath(fieldPath);
    const siblingPath = parentObjectPath ? `${parentObjectPath}.${dependency.key}` : dependency.key;
    const siblingValue = readPathValue(allValues, siblingPath);
    if (siblingValue !== undefined && siblingValue !== null) {
      return siblingValue;
    }
  }

  const direct = readPathValue(allValues, dependency.key);
  if (direct !== undefined && direct !== null) {
    return direct;
  }

  if (dependency.key === "SelectedFamilyNames") {
    const equaling = readPathValue(allValues, "FilterFamilies.IncludeNames.Equaling");
    if (Array.isArray(equaling) && equaling.length > 0) {
      return equaling;
    }
  }

  return undefined;
}

function buildContextValues(
  dependencies: NormalizedRenderFieldOptionDependency[],
  fieldPath: string,
  allValues: SettingsValues,
): Record<string, string> {
  const entries = dependencies
    .map((dependency) => {
      const raw = resolveContextDependencyValue(dependency, fieldPath, allValues);
      const serialized = serializeContextValue(raw);
      return serialized ? ([dependency.key, serialized] as const) : undefined;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : {};
}

function toLocalItems(values: string[]): FieldOptionItem[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  ).map((value) => ({
    value,
    label: value,
    description: "",
  }));
}

function toLocalItemsFromExamples(values: unknown[]): FieldOptionItem[] {
  return toLocalItems(
    values.flatMap((value) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return [String(value)];
      }

      return [];
    }),
  );
}

function parseDelimitedContextValues(value: string | undefined): string[] {
  return (
    value
      ?.split("|")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );
}

function projectFamilyParameterCatalogValues(
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

function projectParameterCatalogItems(
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

export function useFieldOptions({
  node,
  providerNode,
  fieldPath,
}: {
  node: SchemaNodeRef;
  providerNode?: SchemaNodeRef;
  fieldPath: string;
}) {
  const { moduleKey, values: allValues } = useSchemaRenderContext();
  const { rootKey } = useSchemaRenderContext();
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
  const remoteQuery = useFieldOptionsQuery(request, {
    enabled: usesRemoteResolver,
  });
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

  if (usesRemoteResolver && remoteSource && (remoteQuery.isPending || remoteQuery.isFetching)) {
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
    (parameterCatalogQuery.isPending || parameterCatalogQuery.isFetching)
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
