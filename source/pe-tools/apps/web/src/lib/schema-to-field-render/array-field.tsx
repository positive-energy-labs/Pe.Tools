import { Button } from "#/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "#/components/ui/combobox";
import { Textarea } from "#/components/ui/textarea";
import { FieldRenderer } from "./field-renderer";
import { FieldLabelRow, FieldMessages, FieldOptionsMetadata } from "./field-metadata";
import {
  buildDefaultArrayItem,
  clearFieldServerErrors,
  coercePrimitive,
  formatFormError,
  type ResolvedFieldRendererProps,
  type SettingsFieldApi,
  useFieldOptions,
  useSettingsForm,
} from "./shared";

export function ArrayField({
  path,
  effectiveNodeRef,
  label,
  isRequired,
  placeholder,
}: ResolvedFieldRendererProps) {
  const form = useSettingsForm();
  const rawItemNodeRef = effectiveNodeRef.item();
  const itemNodeRef = rawItemNodeRef?.effective() ?? rawItemNodeRef;
  const itemNode = itemNodeRef?.raw();
  const itemType = itemNodeRef?.kind();
  const isPrimitiveArray =
    itemType === "string" ||
    itemType === "number" ||
    itemType === "integer" ||
    itemType === "boolean";
  const isObjectArray = itemType === "object" && Boolean(itemNode?.properties);
  const description = effectiveNodeRef.description();
  const defaultValue = effectiveNodeRef.hasExplicitDefault()
    ? effectiveNodeRef.explicitDefault()
    : undefined;
  const itemHasOptions = Boolean(rawItemNodeRef?.optionSource());
  const providerNode = itemHasOptions ? rawItemNodeRef : effectiveNodeRef;
  const optionsState = useFieldOptions({
    node: itemNodeRef ?? effectiveNodeRef,
    providerNode: providerNode ?? undefined,
    fieldPath: path,
  });
  const { items } = optionsState;
  const comboboxItems = items.map((item) => item.value);

  return (
    <form.Field name={path as never}>
      {(field: SettingsFieldApi) => (
        <div className="flex flex-col gap-2">
          <FieldLabelRow
            label={label}
            required={isRequired}
            description={description}
            defaultValue={defaultValue}
            path={path}
          />
          {isPrimitiveArray ? (
            <Combobox
              items={comboboxItems}
              multiple
              value={
                Array.isArray(field.state.value)
                  ? field.state.value.map((entry: unknown) => String(entry).trim()).filter(Boolean)
                  : []
              }
              onValueChange={(next) => {
                clearFieldServerErrors(form, path);
                field.handleChange(next.map((value) => coercePrimitive(value, itemType)) as never);
              }}
            >
              <ComboboxChips>
                <ComboboxValue>
                  {(Array.isArray(field.state.value) ? field.state.value : []).map(
                    (item: unknown) => (
                      <ComboboxChip key={String(item)}>{String(item)}</ComboboxChip>
                    ),
                  )}
                </ComboboxValue>
                <ComboboxChipsInput placeholder={placeholder || "Search or type a value"} />
              </ComboboxChips>
              <ComboboxContent>
                <ComboboxEmpty>No matching suggestions.</ComboboxEmpty>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          ) : isObjectArray && itemNode?.properties ? (
            <div className="space-y-4">
              {(Array.isArray(field.state.value) ? (field.state.value as unknown[]) : []).map(
                (_, index) => {
                  const childPathPrefix = `${path}.${index}`;
                  return (
                    <div
                      key={childPathPrefix}
                      className="space-y-3 rounded-md border border-border p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Item {index + 1}
                        </span>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            clearFieldServerErrors(form, path);
                            field.removeValue(index);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                      {(itemNodeRef?.sortedProperties() ?? []).map(([childKey, childNodeRef]) => (
                        <FieldRenderer
                          key={`${childPathPrefix}.${childKey}`}
                          path={`${childPathPrefix}.${childKey}`}
                          node={childNodeRef.raw()}
                        />
                      ))}
                    </div>
                  );
                },
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  clearFieldServerErrors(form, path);
                  field.pushValue(buildDefaultArrayItem(itemNodeRef) as never);
                }}
              >
                Add item
              </Button>
            </div>
          ) : (
            <Textarea
              value={JSON.stringify(field.state.value ?? [], null, 2)}
              onBlur={field.handleBlur}
              onChange={(event) => {
                try {
                  clearFieldServerErrors(form, path);
                  const next = JSON.parse(event.currentTarget.value);
                  field.handleChange(next as never);
                } catch {
                  // Keep user input editable while JSON is invalid.
                }
              }}
              className="min-h-32 font-mono text-xs"
            />
          )}
          <span className="text-xs text-muted-foreground">
            {isPrimitiveArray
              ? "Multi-value combobox with searchable suggestions and removable chips."
              : isObjectArray
                ? "Array item object fields are fully editable."
                : "Array is currently edited as JSON for the MVP."}
          </span>
          <FieldOptionsMetadata options={optionsState} />
          <FieldMessages messages={field.state.meta.errors.map(formatFormError)} />
        </div>
      )}
    </form.Field>
  );
}
