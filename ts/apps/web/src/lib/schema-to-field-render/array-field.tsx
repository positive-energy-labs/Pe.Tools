import { useState } from "react";

import { ActionButton } from "#/components/lang/action-button";
import { ListChips, ListPopup } from "#/components/lang/list-popup";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { JsonEditor, stringify } from "#/components/lang/code";
import { FieldRenderer } from "./field-renderer";
import { FieldLabelRow, FieldMessages, FieldOptions } from "./field-metadata";
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
  const values = Array.isArray(field.value)
    ? field.value.map((entry: unknown) => String(entry).trim()).filter(Boolean)
    : [];
  // A typed value is kept beside the suggestions, so it stays a row the list can toggle off.
  const choices = [...new Set([...values, ...items.map((item) => item.value)])];

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
        <ListPopup<string>
          anchor="trigger"
          face="field"
          triggerLabel={label}
          trigger={
            <ListChips
              labels={values.map((value) => (
                <span className="face-mono">{value}</span>
              ))}
              none={placeholder || "Search or type a value"}
            />
          }
          aria-label={label}
          items={choices}
          keyOf={(value) => value}
          labelOf={(value) => value}
          filter="substring"
          searchPlaceholder="search or type a value…"
          select="multi"
          selected={values}
          onSelectedChange={(next) =>
            field.change(next.map((value) => coercePrimitive(value, itemType)))
          }
          onCreate={(text) =>
            field.change([...values, text].map((value) => coercePrimitive(value, itemType)))
          }
          createLabel={(text) => `add “${text}”`}
          empty="no suggestions — type a value"
          noMatch="no matching suggestions"
          row={(value) => ({ label: <span className="face-mono">{value}</span> })}
        />
      ) : isObjectArray && itemNode?.properties ? (
        <div className="hairline-t">
          <div className="flex items-center justify-between px-2 py-1" data-surface="artifact">
            <span className="t-small face-mono t-upper text-ink-2">
              {(Array.isArray(field.value) ? field.value : []).length} items
            </span>
            <ActionButton
              label="add item"
              reason="Append an item built from the schema's own defaults for this list. The change lives in the form until save writes it."
              onClick={() => {
                field.push(buildDefaultArrayItem(itemNodeRef));
              }}
            />
          </div>
          <div className="hairline-rows">
            {(Array.isArray(field.value) ? (field.value as unknown[]) : []).map((_, index) => {
              const childPathPrefix = `${path}.${index}`;
              return (
                <div key={childPathPrefix} className="boundary-l space-y-2 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="t-small face-mono t-upper text-ink-2">item {index + 1}</span>
                    <ActionButton
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
        <JsonArray label={label} value={field.value ?? []} onChange={field.change} />
      )}
      {isObjectArray ? null : (
        <span className="t-small face-mono text-ink-2">
          {isPrimitiveArray
            ? "Multi-value combobox with searchable suggestions and removable chips."
            : "Array is currently edited as JSON for the MVP."}
        </span>
      )}
      <FieldOptions options={optionsState} />
      <FieldMessages messages={field.errors} compact />
    </div>
  );
}

/**
 * The array as raw JSON, for the shapes the field renderer has no widget for.
 *
 * Parse-on-change: a parse that succeeds commits to the field, a parse that fails leaves the
 * field alone and the head says `invalid JSON`.
 *
 * The editor holds the TEXT, not a re-serialization of the field. `from` remembers the
 * serialized value this editor last committed, so a field change that came from outside (a
 * reset, another pane, a defaulting pass) still replaces the text, while the caller echoing our
 * own commit back does not. Re-serializing on every valid keystroke moved the caret to the end
 * of the line — the `Textarea` this replaced did exactly that, and it was a bug, not a contract.
 */
export function JsonArray({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const serialized = stringify(value);
  const [held, setHeld] = useState({ text: serialized, from: serialized, bad: false });
  // The field moved under us: adopt its text. React's own "adjust state when a prop changes"
  // pattern — a render-phase set, no effect, no extra paint.
  if (held.from !== serialized) setHeld({ text: serialized, from: serialized, bad: false });
  return (
    <ArtifactFrame
      head={
        <>
          <span className="t-small t-upper text-ink-2">{label}</span>
          <span className="ml-auto t-small face-mono" data-tone={held.bad ? "alarm" : undefined}>
            {held.bad ? "invalid JSON" : "valid"}
          </span>
        </>
      }
    >
      <JsonEditor
        aria-label={`${label} as JSON`}
        value={held.text}
        onChange={(next) => {
          try {
            const parsed: unknown = JSON.parse(next);
            onChange(parsed);
            setHeld({ text: next, from: stringify(parsed), bad: false });
          } catch {
            setHeld((current) => ({ ...current, text: next, bad: true }));
          }
        }}
      />
    </ArtifactFrame>
  );
}
