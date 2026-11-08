import { z } from "zod";
import { Schema } from "effect";
import { hostOpCatalog } from "./generated/host-catalog.generated.ts";
import type { HostOperationKey, OpRequestOf, OpResponseOf } from "./operation-types.ts";
import { wire, type SelectedSdkTypes } from "./vendor/generated/pe-revit-wire.ts";

type SdkWireShape =
  | string
  | { literal: unknown }
  | { union: SdkWireShape[] }
  | { array: SdkWireShape }
  | { fields: Record<string, SdkWireShape> };
type SdkSchema<K extends keyof SelectedSdkTypes> = K extends keyof typeof wire
  ? (typeof wire)[K] extends { fields: object }
    ? z.ZodObject<{ [P in keyof SelectedSdkTypes[K]]: z.ZodType<SelectedSdkTypes[K][P]> }>
    : z.ZodType<SelectedSdkTypes[K]>
  : never;
const sdkDefinitions: Record<string, SdkWireShape> = wire;
const sdkSchemas = new Map<string, z.ZodType>();
function sdkNamed(name: string): z.ZodType {
  const cached = sdkSchemas.get(name);
  if (cached) return cached;
  const shape = sdkDefinitions[name];
  if (!shape) throw Error(`Missing generated SDK schema ${name}`);
  const schema = sdkShape(shape);
  sdkSchemas.set(name, schema);
  return schema;
}
function sdkShape(shape: SdkWireShape): z.ZodType {
  if (typeof shape === "string") {
    if (shape === "unknown") return z.unknown();
    if (shape === "null") return z.null();
    if (shape === "string") return z.string();
    if (shape === "number") return z.number();
    if (shape === "boolean") return z.boolean();
    return z.lazy(() => sdkNamed(shape));
  }
  if ("literal" in shape) {
    const value = shape.literal;
    if (value !== null && !["string", "number", "boolean"].includes(typeof value))
      throw Error("Unsupported generated SDK literal");
    return z.literal(value as string | number | boolean | null);
  }
  if ("union" in shape) return z.union(shape.union.map(sdkShape));
  if ("array" in shape) return z.array(sdkShape(shape.array));
  return z.object(
    Object.fromEntries(
      Object.entries(shape.fields).map(([name, field]) => [name, sdkShape(field)]),
    ),
  );
}
/** Browser-safe schemas projected from the same SDK authority as its generated TS types.
 * Named objects retain their fields for bounded projections; no SDK fields are hand-copied here. */
export const sdkSchema = <K extends keyof SelectedSdkTypes>(name: K): SdkSchema<K> =>
  sdkNamed(name) as SdkSchema<K>;

export const effectDecoder = <S extends Schema.ConstraintDecoder<unknown, never>>(schema: S) =>
  z.unknown().transform((value, ctx) => {
    try {
      return Schema.decodeUnknownSync(schema)(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
      });
      return z.NEVER;
    }
  });
const cache = new Map<string, z.ZodType>();
function generatedSchema(key: string, side: "request" | "response"): z.ZodType {
  const id = `${key}:${side}`;
  let schema = cache.get(id);
  if (!schema) {
    const op = hostOpCatalog.find((op) => op.key === key);
    const json = op?.[side === "request" ? "requestSchemaJson" : "responseSchemaJson"];
    if (!json) throw Error(`Missing generated ${side} schema for ${key}`);
    schema = generatedJsonSchema(JSON.parse(json));
    cache.set(id, schema);
  }
  return schema;
}
export const nativeRequestSchema = <K extends HostOperationKey>(
  key: K,
): z.ZodType<OpRequestOf<K>> => generatedSchema(key, "request") as z.ZodType<OpRequestOf<K>>;
export const nativeResponseSchema = <K extends HostOperationKey>(
  key: K,
): z.ZodType<OpResponseOf<K>> => generatedSchema(key, "response") as z.ZodType<OpResponseOf<K>>;

/** Decode a content-addressed record using the definition emitted with its C# response. */
export function nativeResponseDefinitionSchema<T>(
  key: HostOperationKey,
  definition: string,
): z.ZodType<T> {
  const json = hostOpCatalog.find((op) => op.key === key)?.responseSchemaJson;
  if (!json) throw Error(`Missing generated response schema for ${key}`);
  const root = JSON.parse(json);
  if (!root.definitions?.[definition]) throw Error(`Missing generated definition ${definition}`);
  return generatedJsonSchema({ ...root, ...root.definitions[definition] }) as z.ZodType<T>;
}

/** JSON Schema date-time permits offsets; Zod 4.3's converter incorrectly accepts UTC only. */
export function generatedJsonSchema(json: object): z.ZodType {
  const pattern = z.toJSONSchema(z.iso.datetime({ offset: true })).pattern;
  const adapted = JSON.parse(
    JSON.stringify(json, (_key, value) => {
      if (value && typeof value === "object" && value.format === "date-time") {
        const { format: _, ...rest } = value;
        return { ...rest, pattern };
      }
      return value;
    }),
  );
  return z.fromJSONSchema(adapted);
}
