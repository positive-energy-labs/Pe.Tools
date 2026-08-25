import { useEffect, useMemo, useRef } from "react";
import { FieldRenderer } from "./field-renderer";
import {
  SchemaRenderProvider,
  type SchemaToFieldRenderProps,
  type SettingsValues,
  updateFieldServerErrors,
} from "./shared";
import { SchemaDocument, type SchemaNodeRef } from "@pe/schema-core";
import { buildFieldChangeMap, projectHostValidationState } from "./field-state";

export function SchemaToFieldRender({
  form,
  schema,
  moduleKey,
  rootKey,
  baselineValues,
  validationResult,
  values: controlledValues,
  onChange,
}: SchemaToFieldRenderProps) {
  const schemaDocument = useMemo(() => SchemaDocument.from(schema), [schema]);
  const rootEntries = useMemo(
    () => schemaDocument.root().effective().sortedProperties(),
    [schemaDocument],
  );
  const projectedValidationState = useMemo(
    () => projectHostValidationState(schemaDocument, validationResult),
    [schemaDocument, validationResult],
  );
  const previousProjectedPathsRef = useRef<string[]>([]);
  const controlledForm = useMemo(
    () =>
      form ??
      createControlledForm(controlledValues ?? {}, (path, value) => onChange?.(path, value)),
    [controlledValues, form, onChange],
  );

  useEffect(() => {
    const nextEntries = Array.from(projectedValidationState.fieldIssuesByPath.entries());
    const nextPaths = nextEntries.map(([path]) => path);
    const previousPaths = previousProjectedPathsRef.current;

    for (const previousPath of previousPaths) {
      if (nextPaths.includes(previousPath)) {
        continue;
      }

      updateFieldServerErrors(controlledForm, previousPath, []);
    }

    for (const [path, messages] of nextEntries) {
      updateFieldServerErrors(controlledForm, path, messages);
    }

    previousProjectedPathsRef.current = nextPaths;
  }, [controlledForm, projectedValidationState]);

  if (rootEntries.length === 0) {
    return <p className="text-sm text-muted-foreground">Schema has no editable properties.</p>;
  }

  if (!form)
    return (
      <SchemaToFieldRenderContent
        form={controlledForm}
        moduleKey={moduleKey}
        rootKey={rootKey}
        schemaDocument={schemaDocument}
        rootEntries={rootEntries}
        values={controlledValues ?? {}}
        baselineValues={baselineValues}
      />
    );

  return (
    <controlledForm.Subscribe selector={(state: { values: SettingsValues }) => state.values}>
      {(values: SettingsValues) => (
        <SchemaToFieldRenderContent
          form={controlledForm}
          moduleKey={moduleKey}
          rootKey={rootKey}
          schemaDocument={schemaDocument}
          rootEntries={rootEntries}
          values={values ?? {}}
          baselineValues={baselineValues}
        />
      )}
    </controlledForm.Subscribe>
  );
}

function valueAtPath(values: SettingsValues, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (value, segment) =>
      value != null && typeof value === "object"
        ? (value as Record<string, unknown>)[segment]
        : undefined,
    values,
  );
}

function createControlledForm(
  values: SettingsValues,
  onChange: (path: string, value: unknown) => void,
): NonNullable<SchemaToFieldRenderProps["form"]> {
  return {
    Field: ({ name, children }) => {
      const path = String(name);
      const value = valueAtPath(values, path);
      return children({
        state: { value, meta: { errors: [] } },
        handleBlur: () => undefined,
        handleChange: (next) => onChange(path, next),
        pushValue: (next) => onChange(path, [...(Array.isArray(value) ? value : []), next]),
        removeValue: (index) =>
          onChange(path, (Array.isArray(value) ? value : []).filter((_, at) => at !== index)),
      });
    },
    Subscribe: ({ selector, children }) => children(selector({ values })),
    setFieldMeta: () => undefined,
  };
}

function SchemaToFieldRenderContent({
  form,
  moduleKey,
  rootKey,
  schemaDocument,
  rootEntries,
  values,
  baselineValues,
}: {
  form: NonNullable<SchemaToFieldRenderProps["form"]>;
  moduleKey: string;
  rootKey?: string;
  schemaDocument: SchemaDocument;
  rootEntries: Array<[string, SchemaNodeRef]>;
  values: SettingsValues;
  baselineValues: SettingsValues;
}) {
  const fieldChanges = useMemo(
    () => buildFieldChangeMap(baselineValues, values ?? {}),
    [baselineValues, values],
  );

  return (
    <SchemaRenderProvider
      form={form}
      schemaDocument={schemaDocument}
      moduleKey={moduleKey}
      rootKey={rootKey}
      allValues={values ?? {}}
      fieldChanges={fieldChanges}
    >
      <div className="space-y-5">
        {rootEntries.map(([key, nodeRef]) => (
          <FieldRenderer key={key} path={key} node={nodeRef.raw()} />
        ))}
      </div>
    </SchemaRenderProvider>
  );
}
