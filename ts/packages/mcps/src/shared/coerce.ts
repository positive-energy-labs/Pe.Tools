/**
 * MCP clients see `z.unknown()` params as type-less JSON schema properties and some
 * (correctly, per spec ambiguity) send the JSON as a string. Coerce those back to
 * objects/arrays so untyped pass-through params behave the same from every client.
 */
export function coerceJsonObject(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}
