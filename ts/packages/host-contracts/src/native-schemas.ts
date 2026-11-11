/**
 * The catalog-generated native request/response schemas, zod-only: a Pod artifact bundles this
 * module (no effect, which `decoders.ts` keeps for `effectDecoder`). Imports only zod, the
 * generated catalog, and types (the host read door, `apps/host/src/reads/door.ts`, is pinned).
 */
import { z } from "zod";
import { hostOpCatalog } from "./generated/host-catalog.generated.ts";
import type { HostOperationKey, OpRequestOf, OpResponseOf } from "./operation-types.ts";

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
