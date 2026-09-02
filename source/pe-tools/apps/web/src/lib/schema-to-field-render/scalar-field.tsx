import { Input } from "#/components/lang/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/lang/select";
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
  const datalistId = `${path.replaceAll(".", "-")}-options`;
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
          <Select value={primitiveInputValue(field.value)} onValueChange={field.change}>
            <SelectTrigger id={path} face="mono">
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {sanitizedItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <>
            <Input
              id={path}
              face="mono"
              type={isNumber ? "number" : "text"}
              list={datalistId}
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
            <datalist id={datalistId}>
              {sanitizedItems.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </datalist>
          </>
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
