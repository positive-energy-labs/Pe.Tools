import { useState } from "react";
import { ActionButton } from "#/components/lang/action-button";
import { Input } from "#/components/lang/input";
import { OutcomeLine } from "#/components/lang/outcome";
import { FieldLegendRow, FieldMessages } from "./field-metadata";
import { FieldRenderer, recordValueNode } from "./field-renderer";
import { type ResolvedFieldRendererProps, useSchemaDocument, useSettingsField } from "./shared";

/**
 * Guard: form paths are dot-joined and digit segments read as list indexes, so the form cannot
 * address a key with a dot (`Ref. Level`, a real datum name) or only digits. Raw mode still can.
 */
const unaddressable = (key: string) => key.includes(".") || /^\d+$/.test(key);

/**
 * An object: its declared properties, then, when it is a record (`additionalProperties` a schema),
 * one row per author key rendering the value's own schema inline, with add and remove key.
 * ponytail: every row is open; a collapsible row is the upgrade if a large `types` map crowds the pane.
 */
export function ObjectField({
  path,
  effectiveNodeRef,
  label,
  isRequired,
}: ResolvedFieldRendererProps) {
  const field = useSettingsField(path);
  const schemaDocument = useSchemaDocument();
  const [newKey, setNewKey] = useState("");
  const propertyEntries = effectiveNodeRef.sortedProperties();
  const valueNode = recordValueNode(effectiveNodeRef.raw());
  const value =
    field.value && typeof field.value === "object" && !Array.isArray(field.value)
      ? (field.value as Record<string, unknown>)
      : {};
  const declared = effectiveNodeRef.raw().properties ?? {};
  const keys = valueNode ? Object.keys(value).filter((key) => !(key in declared)) : [];
  if (propertyEntries.length === 0 && !valueNode) {
    return null;
  }

  const keyRefusal = !newKey.trim()
    ? "Type a key first."
    : newKey in value
      ? `${newKey} is already a key here.`
      : unaddressable(newKey)
        ? "The form cannot address a key with a dot or only digits; add it in raw mode."
        : null;

  return (
    <fieldset className="boundary-l space-y-2 pl-3">
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
      <div className="hairline-rows">
        {propertyEntries.map(([childKey, childNodeRef]) => {
          const childPath = `${path}.${childKey}`;
          return (
            <div key={childPath} className="py-2 first:pt-0 last:pb-0">
              <FieldRenderer path={childPath} node={childNodeRef.raw()} />
            </div>
          );
        })}
        {keys.map((key) => {
          const childPath = `${path}.${key}`;
          return (
            <div key={childPath} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                {unaddressable(key) ? (
                  <OutcomeLine
                    kind="refused"
                    label={key}
                    says="the form cannot address a key with a dot or only digits; edit it in raw mode"
                  />
                ) : (
                  <FieldRenderer path={childPath} node={valueNode!} />
                )}
              </div>
              <ActionButton
                label="remove key"
                reason={`Drop ${key} from ${label}. The change lives in the form until save writes it.`}
                onClick={() => {
                  const { [key]: _dropped, ...rest } = value;
                  field.change(rest);
                }}
              />
            </div>
          );
        })}
      </div>
      {valueNode ? (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`new ${label} key`}
            face="mono"
            value={newKey}
            placeholder="new key"
            onChange={(event) => setNewKey(event.currentTarget.value)}
          />
          <ActionButton
            label="add key"
            disabled={keyRefusal !== null}
            reason={
              keyRefusal ??
              `Add ${newKey} to ${label}, built from the schema's defaults. The change lives in the form until save writes it.`
            }
            onClick={() => {
              field.change({
                ...value,
                [newKey]: schemaDocument.ref(`${path}.${newKey}`, valueNode).defaultValue() ?? null,
              });
              setNewKey("");
            }}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
