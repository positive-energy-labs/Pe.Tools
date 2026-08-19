import { FieldLegendRow, FieldMessages } from "./field-metadata";
import { FieldRenderer } from "./field-renderer";
import {
  formatFormError,
  type ResolvedFieldRendererProps,
  type SettingsFieldApi,
  useSettingsForm,
} from "./shared";

export function ObjectField({
  path,
  effectiveNodeRef,
  label,
  isRequired,
}: ResolvedFieldRendererProps) {
  const form = useSettingsForm();
  const propertyEntries = effectiveNodeRef.sortedProperties();
  if (propertyEntries.length === 0) {
    return null;
  }

  return (
    <form.Field name={path as never}>
      {(field: SettingsFieldApi) => (
        <fieldset className="space-y-4 rounded-lg border border-border p-4">
          <legend>
            <FieldLegendRow
              label={label}
              required={isRequired}
              description={effectiveNodeRef.description()}
              defaultValue={
                effectiveNodeRef.hasExplicitDefault()
                  ? effectiveNodeRef.explicitDefault()
                  : undefined
              }
              path={path}
            />
          </legend>
          <FieldMessages messages={field.state.meta.errors.map(formatFormError)} />
          {propertyEntries.map(([childKey, childNodeRef]) => {
            const childPath = `${path}.${childKey}`;
            return <FieldRenderer key={childPath} path={childPath} node={childNodeRef.raw()} />;
          })}
        </fieldset>
      )}
    </form.Field>
  );
}
