import { useMemo } from "react";
import { FieldRenderer } from "./field-renderer";
import {
  SchemaRenderProvider,
  type RemoteOptionsHook,
  type SchemaToFieldRenderProps,
  type SettingsValues,
} from "./shared";
import { SchemaDocument, type SchemaNodeRef } from "@pe/schema-core";
import { buildFieldChangeMap, projectHostValidationState } from "./field-state";

export function SchemaToFieldRender({
  schema,
  schemaUrl,
  baselineValues,
  validationResult,
  values,
  onChange,
  useRemoteOptions,
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
      schemaUrl={schemaUrl}
      schemaDocument={schemaDocument}
      rootEntries={rootEntries}
      values={values}
      baselineValues={baselineValues}
      onChange={onChange}
      errors={projectedValidationState.fieldIssuesByPath}
      useRemoteOptions={useRemoteOptions}
    />
  );
}

function SchemaToFieldRenderContent({
  schemaUrl,
  schemaDocument,
  rootEntries,
  values,
  baselineValues,
  onChange,
  errors,
  useRemoteOptions,
}: {
  schemaUrl: string | null;
  schemaDocument: SchemaDocument;
  rootEntries: Array<[string, SchemaNodeRef]>;
  values: SettingsValues;
  baselineValues: SettingsValues;
  onChange: (path: string, value: unknown) => void;
  errors: ReadonlyMap<string, string[]>;
  useRemoteOptions?: RemoteOptionsHook;
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
      schemaUrl={schemaUrl}
      fieldChanges={fieldChanges}
      useRemoteOptions={useRemoteOptions}
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

export type { RemoteOptionsHook } from "./shared";
