import { useMemo } from "react";
import { changedInRevit, previousOf, useFieldOptionsReading } from "#/readings";
import type { SchemaNodeRef } from "@pe/schema-core";
import { normalizeFieldOptionMode, readPathValue } from "@pe/schema-core";
import type { FieldOptionItem, FieldOptionState, FieldRendererProps } from "./field-option";
import {
  buildContextValues,
  toLocalItems,
  useSchemaDocument,
  useSchemaRenderContext,
} from "./field-option";

function toLocalItemsFromExamples(values: unknown[]): FieldOptionItem[] {
  return toLocalItems(
    values.flatMap((value) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? [String(value)]
        : [],
    ),
  );
}

/**
 * A field's options: a schema enum, a HostOnly domain's values baked into the schema, or the
 * field-options Reading from the render's document. A baked field never reads.
 */
export function useFieldOptions({
  node,
  providerNode,
  fieldPath,
}: {
  node: SchemaNodeRef;
  providerNode?: SchemaNodeRef;
  fieldPath: string;
}): FieldOptionState {
  const { values: allValues, optionsFrom } = useSchemaRenderContext();
  const source = useMemo(() => (providerNode ?? node).optionSource(), [providerNode, node]);
  const contextValues = useMemo(
    () => buildContextValues(source?.dependsOn ?? [], fieldPath, allValues),
    [allValues, fieldPath, source],
  );
  const dependencies = useMemo(
    () =>
      (source?.dependsOn ?? []).map((dependency) => ({
        ...dependency,
        value: contextValues[dependency.key],
      })),
    [contextValues, source?.dependsOn],
  );
  const enumItems = useMemo(() => {
    const rawNode = node.raw();
    return Array.isArray(rawNode.enum) ? toLocalItems(rawNode.enum.map(String)) : [];
  }, [node]);
  const inlineItems = useMemo(() => {
    const rawNode = node.raw();
    return Array.isArray(rawNode.examples) ? toLocalItemsFromExamples(rawNode.examples) : [];
  }, [node]);
  const baked =
    enumItems.length > 0 || (source?.requiredRuntimeMode === "HostOnly" && inlineItems.length > 0);
  const reading = useFieldOptionsReading(baked ? null : optionsFrom, source?.key, contextValues);
  const read = previousOf(reading);
  const common = {
    sourceKey: source?.key,
    runtime: source?.requiredRuntimeMode,
    changed: changedInRevit(reading),
    dependencies,
  };

  if (enumItems.length > 0)
    return {
      ...common,
      items: enumItems,
      mode: "constraint",
      allowsCustomValue: false,
      isLoading: false,
      source: "enum",
    };

  if (source && !baked && read && read.items.length > 0)
    return {
      ...common,
      items: read.items,
      mode: normalizeFieldOptionMode(read.descriptor.mode) ?? source.mode,
      allowsCustomValue: read.descriptor.allowsCustomValue,
      isLoading: false,
      errorMessage: read.result.kind === "Success" ? undefined : read.result.message,
      source: "remote",
    };

  return {
    ...common,
    items: inlineItems,
    mode: source?.mode ?? "suggestion",
    allowsCustomValue: source?.allowsCustomValue ?? true,
    isLoading: reading.state === "loading",
    errorMessage:
      reading.state === "failed"
        ? reading.message
        : read && read.result.kind !== "Success"
          ? read.result.message
          : undefined,
    source: source && !baked ? "remote" : inlineItems.length > 0 ? "examples" : "none",
  };
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
