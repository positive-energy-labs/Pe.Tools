import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { FieldLabelRow, FieldMessages, FieldOptionsMetadata } from "./field-metadata";
import {
  coercePrimitive,
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
    <div className="flex flex-col gap-2">
      <FieldLabelRow
        label={label}
        htmlFor={path}
        required={isRequired}
        description={description}
        defaultValue={defaultValue}
        path={path}
      />
      {shouldRenderSelect ? (
        <Select value={String(field.value ?? "")} onValueChange={field.change}>
          <SelectTrigger id={path} className="h-9 w-full justify-between">
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
        <div className="flex items-center gap-3">
          <Switch
            checked={Boolean(field.value)}
            id={path}
            size="sm"
            onCheckedChange={field.change}
          />
          <span className="">{field.value ? "Enabled" : "Disabled"}</span>
        </div>
      ) : options.length > 0 && allowsCustomValue ? (
        <>
          <Input
            id={path}
            type={isNumber ? "number" : "text"}
            list={datalistId}
            value={String(field.value ?? "")}
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
          type={isNumber ? "number" : "text"}
          value={String(field.value ?? "")}
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
      <FieldOptionsMetadata options={optionsState} />
      <FieldMessages messages={field.errors} />
    </div>
  );
}
