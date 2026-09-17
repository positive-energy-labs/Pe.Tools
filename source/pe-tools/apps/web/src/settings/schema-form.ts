import { applySchemaDefaultsToValue, parseSchema, type RenderSchemaNode } from "@pe/schema-core";

interface SchemaFormModel {
  schema: RenderSchemaNode;
  parsedRaw: Record<string, unknown>;
  baseline: Record<string, unknown>;
}

function parseDocumentRaw(rawContent: string | null | undefined) {
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
