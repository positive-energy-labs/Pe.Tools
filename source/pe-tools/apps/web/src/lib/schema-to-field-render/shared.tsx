import type { AnyFieldApi } from "@tanstack/react-form";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  FieldOptionItem,
  FieldOptionsRequest,
  ParameterCatalogEntry,
  SettingsValidationResult,
} from "#/host/settings-contracts";
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

export type SettingsFieldApi = AnyFieldApi;
export interface SettingsFieldMetaBase {
  isTouched: boolean;
  isBlurred: boolean;
  isDirty: boolean;
  isValidating: boolean;
  errorMap: Record<string, unknown>;
  errorSourceMap: Record<string, unknown>;
}

function createEmptyFieldMeta(): SettingsFieldMetaBase {
  return {
    isTouched: false,
    isBlurred: false,
    isDirty: false,
    isValidating: false,
    errorMap: {},
    errorSourceMap: {},
  };
}

export interface SettingsForm {
  Field: (props: {
    name: never;
    children: (field: SettingsFieldApi) => ReactNode;
  }) => ReactNode | Promise<ReactNode>;
  Subscribe: (props: {
    selector: (state: { values: SettingsValues }) => SettingsValues;
    children: (values: SettingsValues) => ReactNode;
  }) => ReactNode | Promise<ReactNode>;
  setFieldMeta: (
    name: never,
    updater: (meta: SettingsFieldMetaBase | undefined) => SettingsFieldMetaBase,
  ) => void;
}
export type SettingsValues = Record<string, unknown>;

export interface SchemaToFieldRenderProps {
  form: SettingsForm;
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
  items: FieldOptionItem[];
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
  form: SettingsForm;
  moduleKey: string;
  rootKey?: string;
  values: SettingsValues;
  schemaDocument: SchemaDocument;
  fieldChanges: ReadonlyMap<string, FieldChangeSummary>;
}

const SchemaRenderContext = createContext<SchemaRenderContextValue | null>(null);

export function SchemaRenderProvider({
  form,
  schemaDocument,
  moduleKey,
  rootKey,
  allValues,
  fieldChanges,
  children,
}: {
  form: SettingsForm;
  schemaDocument: SchemaDocument;
  moduleKey: string;
  rootKey?: string;
  allValues: SettingsValues;
  fieldChanges: ReadonlyMap<string, FieldChangeSummary>;
  children: ReactNode;
}) {
  const contextValue = useMemo(
    () => ({
      form,
      moduleKey,
      rootKey,
      values: allValues,
      schemaDocument,
      fieldChanges,
    }),
    [allValues, fieldChanges, form, moduleKey, schemaDocument, rootKey],
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

export function useSettingsForm() {
  return useSchemaRenderContext().form;
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

export function updateFieldServerErrors(form: SettingsForm, path: string, messages: string[]) {
  form.setFieldMeta(path as never, (meta) => {
    const currentMeta = meta ?? createEmptyFieldMeta();
    const nextErrorMap = { ...currentMeta.errorMap };
    const nextErrorSourceMap = { ...currentMeta.errorSourceMap };

    if (messages.length > 0) {
      nextErrorMap.onServer = messages;
      nextErrorSourceMap.onServer = "form";
    } else {
      delete nextErrorMap.onServer;
      delete nextErrorSourceMap.onServer;
    }

    return {
      ...currentMeta,
      errorMap: nextErrorMap,
      errorSourceMap: nextErrorSourceMap,
    };
  });
}

export function clearFieldServerErrors(form: SettingsForm, path: string) {
  updateFieldServerErrors(form, path, []);
}

export function formatFormError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message ?? "Unknown form error");
  }

  return "Unknown form error";
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
  entries: ParameterCatalogEntry[],
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
  entries: ParameterCatalogEntry[],
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
