import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SettingsFieldOptions, SettingsParameterCatalog } from "@pe/host-contracts/generated";
import type { SettingsValidationResult } from "@pe/host-contracts/operation-types";
import type {
  NormalizedRenderFieldOptionDependency,
  RenderSchemaNode,
  SchemaNodeRef,
} from "@pe/schema-core";
import { getFieldOrder, readPathValue, type SchemaDocument } from "@pe/schema-core";
import type { FieldChangeSummary } from "../field-state";

export type FieldOptionItem = SettingsFieldOptions.Res.FieldOptionItem;

export type FieldOptionsRequest = SettingsFieldOptions.Req.Request;

export type ParameterCatalogEntry = SettingsParameterCatalog.Res.ParameterCatalogEntry;

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

export interface SchemaRenderContextValue {
  values: SettingsValues;
  onChange: (path: string, value: unknown) => void;
  errors: ReadonlyMap<string, string[]>;
  moduleKey: string;
  rootKey?: string;
  schemaDocument: SchemaDocument;
  fieldChanges: ReadonlyMap<string, FieldChangeSummary>;
}

export const SchemaRenderContext = createContext<SchemaRenderContextValue | null>(null);

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

export function useSchemaRenderContext() {
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
      onChange(
        path,
        (Array.isArray(value) ? value : []).filter((_, at) => at !== index),
      ),
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

export function primitiveInputValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
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

export function serializeContextValue(value: unknown): string | undefined {
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

export function getParentObjectPath(fieldPath: string) {
  const parts = fieldPath.split(".");
  parts.pop();
  return parts.join(".");
}

export function resolveContextDependencyValue(
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

export function buildContextValues(
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

export function toLocalItems(values: string[]): FieldOptionItem[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  ).map((value) => ({
    value,
    label: value,
    description: "",
  }));
}
