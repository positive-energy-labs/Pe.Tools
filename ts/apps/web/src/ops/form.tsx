/**
 * The request form is the settings form. A bridge op's request schema carries the same
 * `x-options` node the settings pipeline emits (`FieldOptionsAttribute`), so the one renderer
 * draws both, reading options through the same field-options Reading from the target document.
 */
import { useMemo } from "react";
import { applySchemaDefaultsToValue, parseSchema } from "@pe/schema-core";
import type { ExecutionTarget } from "@pe/agent-contracts";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { JsonEditor } from "#/components/lang/code";
import { SchemaToFieldRender } from "#/lib/schema-to-field-render";

export type FormValues = Record<string, unknown>;

/** The seed a freshly selected op starts from: its first example, else its schema defaults. */
export function seedValues(schemaJson: string | undefined, exampleJson: string | undefined) {
  let example: FormValues = {};
  try {
    const parsed: unknown = exampleJson ? JSON.parse(exampleJson) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      example = parsed as FormValues;
  } catch {}
  const schema = schemaJson ? parseSchema(schemaJson) : undefined;
  const seeded = schema ? applySchemaDefaultsToValue(schema, example, schema) : example;
  return seeded && typeof seeded === "object" && !Array.isArray(seeded)
    ? (seeded as FormValues)
    : example;
}

/** Write one dotted path; arrays keep their shape. */
export function setPath(value: unknown, path: readonly string[], next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path as [string, ...string[]];
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[Number(head)] = setPath(copy[Number(head)], rest, next);
    return copy;
  }
  const record = value && typeof value === "object" ? (value as FormValues) : {};
  return { ...record, [head]: setPath(record[head], rest, next) };
}

/** Empty strings and nulls are unset fields, not values; the host fills its own defaults. */
export function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as FormValues).flatMap(([key, item]) => {
        const kept = prune(item);
        return kept === undefined ? [] : [[key, kept]];
      }),
    );
  return value === "" || value === null ? undefined : value;
}

export function OpForm({
  schemaJson,
  values,
  onChange,
  target,
}: {
  schemaJson: string | undefined;
  values: FormValues;
  onChange: (next: FormValues) => void;
  target: ExecutionTarget;
}) {
  const schema = useMemo(() => (schemaJson ? parseSchema(schemaJson) : undefined), [schemaJson]);
  // x-options fields sit on document ops; a host or session target reads no options.
  const optionsFrom = target.kind === "document" ? target.ref : null;
  if (!schema) return <RawRequest values={values} onChange={onChange} />;
  return (
    <SchemaToFieldRender
      schema={schema}
      baselineValues={{}}
      values={values}
      onChange={(path, value) => onChange(setPath(values, path.split("."), value) as FormValues)}
      optionsFrom={optionsFrom}
    />
  );
}

/** Says what `requestOf` would say about this text, without being the parser. */
function parses(text: string): boolean {
  if (!text.trim()) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** A schemaless op has no fields to draw, so the request IS the JSON. `requestOf` is still the
 * only parser — the head's word reports what that parse would say, and refuses nothing. */
function RawRequest({
  values,
  onChange,
}: {
  values: FormValues;
  onChange: (next: FormValues) => void;
}) {
  const raw = typeof values.$raw === "string" ? values.$raw : "{}";
  return (
    <ArtifactFrame
      head={
        <>
          <span className="t-small t-upper text-ink-2">request</span>
          <span className="ml-auto t-small face-mono" data-tone={parses(raw) ? undefined : "alarm"}>
            {parses(raw) ? "valid" : "invalid JSON"}
          </span>
        </>
      }
    >
      <JsonEditor
        aria-label="Operation request JSON"
        value={raw}
        onChange={(next) => onChange({ $raw: next })}
      />
    </ArtifactFrame>
  );
}

/** What `run` sends: the pruned form, or the raw JSON when the op has no schema. */
export function requestOf(values: FormValues): unknown {
  if (typeof values.$raw === "string")
    return values.$raw.trim() ? JSON.parse(values.$raw) : undefined;
  return prune(values);
}
