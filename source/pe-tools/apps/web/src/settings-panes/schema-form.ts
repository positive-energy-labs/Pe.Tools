/**
 * The /settings route's SCHEMA→FORM derivation, as one pure function.
 *
 * Everything the generated form needs is decided here: the module's schema is parsed, the open
 * document's raw text is parsed, and schema defaults are layered over it to produce the form's
 * baseline. `null` means "this document cannot be form-generated" — no schema, unparseable raw,
 * or a root that is not an object — and the route falls back to the flat pointer reviewer, which
 * is the honest reading rather than an empty form.
 *
 * WHY IT IS NOT INLINE IN THE ROUTE: the route body needs a router, an SSE bridge and a query
 * client to run, so the wiring that actually decides whether `/settings?source=fixture` renders a
 * generated form was unprovable without a browser. Here it is three arguments and a return value,
 * and `schema-form.test.tsx` drives it with the SAME fixture the route mounts.
 */
import { applySchemaDefaultsToValue, parseSchema, type RenderSchemaNode } from "@pe/schema-core";

export interface SchemaFormModel {
  /** The parsed schema the `FieldRenderer` walks. */
  schema: RenderSchemaNode;
  /** The document's own content, parsed — the diff target a save measures edits against. */
  parsedRaw: Record<string, unknown>;
  /** `parsedRaw` with schema defaults layered on — what the form is seeded with. */
  baseline: Record<string, unknown>;
}

/** Parse a settings document's raw text. Only an object root can back a form. */
export function parseDocumentRaw(rawContent: string | null | undefined) {
  if (!rawContent?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(rawContent);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function schemaFormModel(
  rawContent: string | null | undefined,
  schemaJson: string | null | undefined,
): SchemaFormModel | null {
  if (!schemaJson) return null;
  const schema = parseSchema(schemaJson);
  const parsedRaw = parseDocumentRaw(rawContent);
  if (!schema || !parsedRaw) return null;
  const withDefaults = applySchemaDefaultsToValue(schema, parsedRaw, schema);
  if (!withDefaults || typeof withDefaults !== "object" || Array.isArray(withDefaults)) return null;
  return { schema, parsedRaw, baseline: withDefaults as Record<string, unknown> };
}
