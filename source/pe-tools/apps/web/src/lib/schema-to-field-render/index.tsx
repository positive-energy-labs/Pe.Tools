import { useMemo } from "react";
import { FieldRenderer } from "./field-renderer";
import { SchemaRenderProvider, type SchemaToFieldRenderProps, type SettingsValues } from "./shared";
import { SchemaDocument, type SchemaNodeRef } from "@pe/schema-core";
import { buildFieldChangeMap, projectHostValidationState } from "./field-state";

export function SchemaToFieldRender({
  schema,
  moduleKey,
  rootKey,
  baselineValues,
  validationResult,
  values,
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
  if (rootEntries.length === 0) {
    return (
      <p className="t-small t-upper text-ink-mute italic">Schema has no editable properties.</p>
    );
  }

  return (
    <SchemaToFieldRenderContent
      moduleKey={moduleKey}
      rootKey={rootKey}
      schemaDocument={schemaDocument}
      rootEntries={rootEntries}
      values={values}
      baselineValues={baselineValues}
      onChange={onChange}
      errors={projectedValidationState.fieldIssuesByPath}
    />
  );
}

function SchemaToFieldRenderContent({
  moduleKey,
  rootKey,
  schemaDocument,
  rootEntries,
  values,
  baselineValues,
  onChange,
  errors,
}: {
  moduleKey: string;
  rootKey?: string;
  schemaDocument: SchemaDocument;
  rootEntries: Array<[string, SchemaNodeRef]>;
  values: SettingsValues;
  baselineValues: SettingsValues;
  onChange: (path: string, value: unknown) => void;
  errors: ReadonlyMap<string, string[]>;
}) {
  const fieldChanges = useMemo(
    () => buildFieldChangeMap(baselineValues, values ?? {}),
    [baselineValues, values],
  );

  return (
    <SchemaRenderProvider
      values={values}
      onChange={onChange}
      errors={errors}
      schemaDocument={schemaDocument}
      moduleKey={moduleKey}
      rootKey={rootKey}
      fieldChanges={fieldChanges}
    >
      <div className="hairline-rows">
        {rootEntries.map(([key, nodeRef]) => (
          <div key={key} className="py-2 first:pt-0 last:pb-0">
            <FieldRenderer path={key} node={nodeRef.raw()} />
          </div>
        ))}
      </div>
    </SchemaRenderProvider>
  );
}
