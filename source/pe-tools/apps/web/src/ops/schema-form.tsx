import { type FactTone } from "#/components/lang/chip";
import type { HostOperationJsonSchema } from "#/ops/route-workspace";

export function resolveSchema(schema: HostOperationJsonSchema, root: HostOperationJsonSchema) {
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.split("/").at(-1) ?? "";
    const definitions = isRecord(root.definitions) ? root.definitions : {};
    return isRecord(definitions[name]) ? definitions[name] : schema;
  }
  const branches = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : [];
  const concrete = branches.find((branch) => isRecord(branch) && branch.type !== "null");
  return isRecord(concrete) ? concrete : schema;
}

export function readFormSeed(json: string, schema?: HostOperationJsonSchema) {
  let seed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(json);
    if (isRecord(value)) seed = value;
  } catch {}
  for (const [name, field] of schemaProperties(schema ?? {}))
    if (!(name in seed) && "default" in field) seed[name] = field.default;
  return seed;
}

export function buildFormRequest(
  schema: HostOperationJsonSchema,
  values: Record<string, unknown>,
  root: HostOperationJsonSchema,
) {
  return Object.fromEntries(
    schemaProperties(schema).flatMap(([name, field]) => {
      const resolved = resolveSchema(field, root);
      const raw = values[name];
      let value: unknown = raw;
      if (raw === "" || raw == null) return [];
      if (schemaType(resolved) === "object" && isRecord(raw))
        value = buildFormRequest(resolved, raw, root);
      else if (schemaType(resolved) === "boolean") value = raw === true || raw === "true";
      else if (schemaType(resolved) === "integer" || schemaType(resolved) === "number")
        value = Number(raw);
      else if (
        (schemaType(resolved) === "array" || schemaType(resolved) === "object") &&
        typeof raw === "string"
      )
        value = JSON.parse(raw);
      return [[name, value]];
    }),
  );
}

export const schemaProperties = (
  schema: HostOperationJsonSchema,
): [string, HostOperationJsonSchema][] =>
  isRecord(schema.properties)
    ? Object.entries(schema.properties).filter(
        (entry): entry is [string, HostOperationJsonSchema] => isRecord(entry[1]),
      )
    : [];

export const schemaType = (schema: HostOperationJsonSchema) =>
  typeof schema.type === "string"
    ? schema.type
    : Array.isArray(schema.type)
      ? schema.type.find((value) => typeof value === "string" && value !== "null")
      : undefined;

export const fieldOptionsKey = (schema: HostOperationJsonSchema) => {
  const options = schema["x-options"];
  return isRecord(options) && typeof options.key === "string" ? options.key : undefined;
};

export const scalarText = (value: unknown) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const costTone = (tier: string): FactTone =>
  tier.toLowerCase() === "expensive" ? "caution" : "meta";
