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
    <fieldset className="space-y-2 border-l-2 border-line-2 pl-3">
      <legend className="w-full">
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
      <FieldMessages messages={field.errors} compact />
      <div className="divide-y divide-line">
        {propertyEntries.map(([childKey, childNodeRef]) => {
          const childPath = `${path}.${childKey}`;
          return (
            <div key={childPath} className="py-2 first:pt-0 last:pb-0">
              <FieldRenderer path={childPath} node={childNodeRef.raw()} />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
