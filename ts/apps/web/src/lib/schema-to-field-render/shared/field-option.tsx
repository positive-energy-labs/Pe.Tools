import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { DocumentRef } from "@pe/agent-contracts";
import type { RevitCatalogFieldOptions } from "@pe/host-contracts/generated";
import type { MemberIssue } from "@pe/host-contracts/operation-types";
import type {
  NormalizedFieldOptionRuntime,
  NormalizedRenderFieldOptionDependency,
  RenderSchemaNode,
  SchemaNodeRef,
} from "@pe/schema-core";
import { readPathValue, type SchemaDocument } from "@pe/schema-core";
import type { FieldChangeSummary } from "../field-state";

export type FieldOptionItem = RevitCatalogFieldOptions.Res.FieldOptionItem;

export type SettingsValues = Record<string, unknown>;

export interface SchemaToFieldRenderProps {
  values: SettingsValues;
  onChange: (path: string, value: unknown) => void;
  schema: RenderSchemaNode;
  baselineValues: SettingsValues;
  /** The host's diagnostics on these values; each lands beside the field its path names. */
  issues?: readonly MemberIssue[];
  /** The document every `x-options` field reads its options from; none reads nothing. */
  optionsFrom?: DocumentRef | null;
}

export interface FieldRendererProps {
  path: string;
  node: RenderSchemaNode;
}

interface FieldOptionDependencyState extends NormalizedRenderFieldOptionDependency {
  value?: string;
}

export interface FieldOptionState {
  items: readonly FieldOptionItem[];
  mode: "suggestion" | "constraint";
  allowsCustomValue: boolean;
  isLoading: boolean;
  errorMessage?: string;
  source: "enum" | "examples" | "remote" | "none";
  sourceKey?: string;
  /** HostOnly values are baked into the schema; LiveDocument values are read from the document. */
  runtime?: NormalizedFieldOptionRuntime;
  /** Revit changed the document after these options were read (LiveDocument keys only). */
  changed: boolean;
  dependencies: FieldOptionDependencyState[];
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
  errors: ReadonlyMap<string, MemberIssue[]>;
  schemaDocument: SchemaDocument;
  fieldChanges: ReadonlyMap<string, FieldChangeSummary>;
  optionsFrom?: DocumentRef | null;
}

const SchemaRenderContext = createContext<SchemaRenderContextValue | null>(null);

export function SchemaRenderProvider({
  values,
  onChange,
  errors,
  schemaDocument,
  fieldChanges,
  optionsFrom,
  children,
}: {
  values: SettingsValues;
  onChange: (path: string, value: unknown) => void;
  errors: ReadonlyMap<string, MemberIssue[]>;
  schemaDocument: SchemaDocument;
  fieldChanges: ReadonlyMap<string, FieldChangeSummary>;
  optionsFrom?: DocumentRef | null;
  children: ReactNode;
}) {
  const contextValue = useMemo(
    () => ({
      values,
      onChange,
      errors,
      schemaDocument,
      fieldChanges,
      optionsFrom,
    }),
    [errors, fieldChanges, onChange, schemaDocument, values, optionsFrom],
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
