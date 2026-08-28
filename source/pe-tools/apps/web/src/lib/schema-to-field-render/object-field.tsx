import { FieldLegendRow, FieldMessages } from "./field-metadata";
import { FieldRenderer } from "./field-renderer";
import { type ResolvedFieldRendererProps, useSettingsField } from "./shared";

export function ObjectField({
  path,
  effectiveNodeRef,
  label,
  isRequired,
}: ResolvedFieldRendererProps) {
  const field = useSettingsField(path);
  const propertyEntries = effectiveNodeRef.sortedProperties();
  if (propertyEntries.length === 0) {
    return null;
  }

  return (
    <fieldset className="space-y-4 rounded-lg border border-line p-4">
      <legend>
        <FieldLegendRow
          label={label}
          required={isRequired}
          description={effectiveNodeRef.description()}
          defaultValue={
            effectiveNodeRef.hasExplicitDefault() ? effectiveNodeRef.explicitDefault() : undefined
          }
          path={path}
        />
      </legend>
      <FieldMessages messages={field.errors} />
      {propertyEntries.map(([childKey, childNodeRef]) => {
        const childPath = `${path}.${childKey}`;
        return <FieldRenderer key={childPath} path={childPath} node={childNodeRef.raw()} />;
      })}
    </fieldset>
  );
}
