/**
 * The request form is the settings form. A bridge op's request schema carries the same
 * `x-options` node the settings pipeline emits (`FieldOptionsAttribute`), so the one renderer
 * draws both; only the option resolver differs, and it is injected here: Revit value domains
 * answer through `revit.catalog.field-options` on the target session.
 */
import { useMemo } from "react";
import { applySchemaDefaultsToValue, parseSchema } from "@pe/schema-core";
import type { ExecutionTarget } from "@pe/agent-contracts";

import { Textarea } from "#/components/lang/textarea";
import { SchemaToFieldRender, type RemoteOptionsHook } from "#/lib/schema-to-field-render";
import { useHostOp } from "#/readings";

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

const sessionOf = (target: ExecutionTarget) =>
  target.kind === "session"
    ? { bridgeSessionId: target.session }
    : target.kind === "document"
      ? { bridgeSessionId: target.ref.session, openDocumentId: target.ref.openId }
      : {};

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
  const scope = sessionOf(target);
  const useRemoteOptions = useMemo<RemoteOptionsHook>(
    () => (request, enabled) =>
      useHostOp(
        "revit.catalog.field-options",
        { sourceKey: request.sourceKey, contextValues: request.contextValues ?? {} },
        { ...scope, enabled: enabled && Boolean(scope.bridgeSessionId) },
      ),
    [scope.bridgeSessionId, scope.openDocumentId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!schema)
    return (
      <Textarea
        size="tall"
        aria-label="Operation request JSON"
        value={typeof values.$raw === "string" ? values.$raw : "{}"}
        onChange={(event) => onChange({ $raw: event.currentTarget.value })}
        spellCheck={false}
      />
    );
  return (
    <SchemaToFieldRender
      schema={schema}
      // ponytail: the settings renderer keys its option requests by module; an op has none.
      moduleKey="ops"
      baselineValues={{}}
      values={values}
      onChange={(path, value) => onChange(setPath(values, path.split("."), value) as FormValues)}
      useRemoteOptions={useRemoteOptions}
    />
  );
}

/** What `run` sends: the pruned form, or the raw JSON when the op has no schema. */
export function requestOf(values: FormValues): unknown {
  if (typeof values.$raw === "string")
    return values.$raw.trim() ? JSON.parse(values.$raw) : undefined;
  return prune(values);
}
