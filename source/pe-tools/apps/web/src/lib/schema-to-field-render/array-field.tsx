import { Verb } from "#/components/lang/verb";
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
} from "#/components/lang/combobox";
import { Textarea } from "#/components/lang/textarea";
import { FieldRenderer } from "./field-renderer";
import { FieldLabelRow, FieldMessages, FieldOptionsMetadata } from "./field-metadata";
import {
  buildDefaultArrayItem,
  coercePrimitive,
  type ResolvedFieldRendererProps,
  useFieldOptions,
  useSettingsField,
} from "./shared";

export function ArrayField({
  path,
  effectiveNodeRef,
  label,
  isRequired,
  placeholder,
}: ResolvedFieldRendererProps) {
  const field = useSettingsField(path);
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
    <div className="flex flex-col gap-1">
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
            Array.isArray(field.value)
              ? field.value.map((entry: unknown) => String(entry).trim()).filter(Boolean)
              : []
          }
          onValueChange={(next) => {
            field.change(next.map((value) => coercePrimitive(value, itemType)));
          }}
        >
          <ComboboxChips>
            <ComboboxValue>
              {(Array.isArray(field.value) ? field.value : []).map((item: unknown) => (
                <ComboboxChip key={String(item)}>{String(item)}</ComboboxChip>
              ))}
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
        <div className="border-t border-line">
          <div className="flex items-center justify-between bg-artifact px-2 py-1">
            <span className="face-mono t-caption t-upper text-ink-2">
              {(Array.isArray(field.value) ? field.value : []).length} items
            </span>
            <Verb
              label="add item"
              reason="Append an item built from the schema's own defaults for this list. The change lives in the form until save writes it."
              onClick={() => {
                field.push(buildDefaultArrayItem(itemNodeRef));
              }}
            />
          </div>
          <div className="divide-y divide-line">
            {(Array.isArray(field.value) ? (field.value as unknown[]) : []).map((_, index) => {
              const childPathPrefix = `${path}.${index}`;
              return (
                <div key={childPathPrefix} className="space-y-2 border-l-2 border-line-2 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="face-mono t-caption t-upper text-ink-2">item {index + 1}</span>
                    <Verb
                      label="remove"
                      reason={`Drop item ${index + 1} from this list. The change lives in the form until save writes it.`}
                      onClick={() => {
                        field.remove(index);
                      }}
                    />
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
            })}
          </div>
        </div>
      ) : (
        <Textarea
          size="tall"
          value={JSON.stringify(field.value ?? [], null, 2)}
          onChange={(event) => {
            try {
              const next = JSON.parse(event.currentTarget.value);
              field.change(next);
            } catch {
              // Keep user input editable while JSON is invalid.
            }
          }}
        />
      )}
      {isObjectArray ? null : (
        <span className="t-caption text-ink-2">
          {isPrimitiveArray
            ? "Multi-value combobox with searchable suggestions and removable chips."
            : "Array is currently edited as JSON for the MVP."}
        </span>
      )}
      <FieldOptionsMetadata options={optionsState} />
      <FieldMessages messages={field.errors} compact />
    </div>
  );
}
