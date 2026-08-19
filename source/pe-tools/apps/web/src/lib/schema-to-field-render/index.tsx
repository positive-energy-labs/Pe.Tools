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

  useEffect(() => {
    const nextEntries = Array.from(projectedValidationState.fieldIssuesByPath.entries());
    const nextPaths = nextEntries.map(([path]) => path);
    const previousPaths = previousProjectedPathsRef.current;

    for (const previousPath of previousPaths) {
      if (nextPaths.includes(previousPath)) {
        continue;
      }

      updateFieldServerErrors(form, previousPath, []);
    }

    for (const [path, messages] of nextEntries) {
      updateFieldServerErrors(form, path, messages);
    }

    previousProjectedPathsRef.current = nextPaths;
  }, [form, projectedValidationState]);

  if (rootEntries.length === 0) {
    return <p className="text-sm text-muted-foreground">Schema has no editable properties.</p>;
  }

  return (
    <form.Subscribe selector={(state: { values: SettingsValues }) => state.values}>
      {(values: SettingsValues) => (
        <SchemaToFieldRenderContent
          form={form}
          moduleKey={moduleKey}
          rootKey={rootKey}
          schemaDocument={schemaDocument}
          rootEntries={rootEntries}
          values={values ?? {}}
          baselineValues={baselineValues}
        />
      )}
    </form.Subscribe>
  );
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
  form: SchemaToFieldRenderProps["form"];
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
