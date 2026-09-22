import { Input } from "#/components/lang/input";
import { ListInput, ListPopup } from "#/components/lang/list-popup";
import { Switch } from "#/components/lang/switch";
import { FieldLabelRow, FieldMessages, FieldOptionsMetadata } from "./field-metadata";
import {
  coercePrimitive,
  primitiveInputValue,
  type ResolvedFieldRendererProps,
  useFieldOptions,
  useSettingsField,
} from "./shared";

export function ScalarField({
  path,
  effectiveNodeRef,
  nodeType,
  label,
  isRequired,
  placeholder,
}: ResolvedFieldRendererProps) {
  const field = useSettingsField(path);
  const optionsState = useFieldOptions({
    node: effectiveNodeRef,
    fieldPath: path,
  });
  const { items, allowsCustomValue, mode } = optionsState;
  const sanitizedItems = items.filter((item) => item.value.trim().length > 0);
  const options = sanitizedItems.map((item) => item.value);
  const isBoolean = nodeType === "boolean";
  const isNumber = nodeType === "number" || nodeType === "integer";
  const shouldRenderSelect = options.length > 0 && (!allowsCustomValue || mode === "constraint");
  const description = effectiveNodeRef.description();
  const defaultValue = effectiveNodeRef.hasExplicitDefault()
    ? effectiveNodeRef.explicitDefault()
    : undefined;

  return (
    <div className="grid grid-cols-[minmax(9rem,0.7fr)_minmax(12rem,1.3fr)] items-start gap-x-3 gap-y-1">
      <FieldLabelRow
        label={label}
        htmlFor={path}
        required={isRequired}
        description={description}
        defaultValue={defaultValue}
        path={path}
      />
      <div className="min-w-0">
        {shouldRenderSelect ? (
          <ListPopup<(typeof sanitizedItems)[number]>
            anchor="trigger"
            face="field"
            triggerLabel={label}
            trigger={
              sanitizedItems.find((item) => item.value === primitiveInputValue(field.value))
                ?.label ?? <span className="text-ink-2">Select an option</span>
            }
            aria-label={label}
            items={sanitizedItems}
            keyOf={(item) => item.value}
            labelOf={(item) => item.label}
            filter="substring"
            searchAbove={8}
            select="single"
            selected={[primitiveInputValue(field.value)]}
            empty="no options"
            onPick={(item) => field.change(item.value)}
            row={(item) => ({ label: item.label })}
          />
        ) : isBoolean ? (
          <div className="flex h-7 items-center gap-2">
            <Switch
              checked={Boolean(field.value)}
              id={path}
              size="sm"
              onCheckedChange={field.change}
            />
            <span className="face-mono text-ink-2">{field.value ? "Enabled" : "Disabled"}</span>
          </div>
        ) : options.length > 0 && allowsCustomValue ? (
          <ListInput
            id={path}
            mono
            aria-label={label}
            value={primitiveInputValue(field.value)}
            onChange={(text) => field.change(isNumber ? coercePrimitive(text, nodeType) : text)}
            suggestions={sanitizedItems}
            placeholder={placeholder}
          />
        ) : (
          <Input
            id={path}
            face="mono"
            type={isNumber ? "number" : "text"}
            value={primitiveInputValue(field.value)}
            onChange={(event) => {
              field.change(
                isNumber
                  ? coercePrimitive(event.currentTarget.value, nodeType)
                  : event.currentTarget.value,
              );
            }}
            placeholder={placeholder}
          />
        )}
      </div>
      <div className="col-start-2 empty:hidden">
        <FieldOptionsMetadata options={optionsState} />
      </div>
      <div className="col-start-2 empty:hidden">
        <FieldMessages messages={field.errors} compact />
      </div>
    </div>
  );
}
