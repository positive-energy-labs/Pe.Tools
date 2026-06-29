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
  clearFieldServerErrors,
  coercePrimitive,
  formatFormError,
  type ResolvedFieldRendererProps,
  type SettingsFieldApi,
  useFieldOptions,
  useSettingsForm,
} from "./shared";

export function ScalarField({
  path,
  effectiveNodeRef,
  nodeType,
  label,
  isRequired,
  placeholder,
}: ResolvedFieldRendererProps) {
  const form = useSettingsForm();
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
    <form.Field name={path as never}>
      {(field: SettingsFieldApi) => (
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
            <Select
              value={String(field.state.value ?? "")}
              onValueChange={(value) => {
                clearFieldServerErrors(form, path);
                field.handleChange(value as never);
              }}
            >
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
                checked={Boolean(field.state.value)}
                id={path}
                size="sm"
                onBlur={field.handleBlur}
                onCheckedChange={(checked) => {
                  clearFieldServerErrors(form, path);
                  field.handleChange(checked as never);
                }}
              />
              <span className="text-sm text-muted-foreground">
                {field.state.value ? "Enabled" : "Disabled"}
              </span>
            </div>
          ) : options.length > 0 && allowsCustomValue ? (
            <>
              <Input
                id={path}
                type={isNumber ? "number" : "text"}
                list={datalistId}
                value={String(field.state.value ?? "")}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  clearFieldServerErrors(form, path);
                  field.handleChange(
                    (isNumber
                      ? coercePrimitive(event.currentTarget.value, nodeType)
                      : event.currentTarget.value) as never,
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
              value={String(field.state.value ?? "")}
              onBlur={field.handleBlur}
              onChange={(event) => {
                clearFieldServerErrors(form, path);
                field.handleChange(
                  (isNumber
                    ? coercePrimitive(event.currentTarget.value, nodeType)
                    : event.currentTarget.value) as never,
                );
              }}
              placeholder={placeholder}
            />
          )}
          <FieldOptionsMetadata options={optionsState} />
          <FieldMessages messages={field.state.meta.errors.map(formatFormError)} />
        </div>
      )}
    </form.Field>
  );
}
