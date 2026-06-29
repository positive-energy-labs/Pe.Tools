import type { RenderSchemaNode, SchemaPrimitiveType } from "./types.ts";

function toTypeList(value: RenderSchemaNode["type"]): SchemaPrimitiveType[] | undefined {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

function valueType(value: unknown): SchemaPrimitiveType {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "null";
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function equals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isDataMatchingSchema(schema: RenderSchemaNode, data: unknown): boolean {
  const types = toTypeList(schema.type);
  if (types && types.length > 0) {
    const actual = valueType(data);
    const allowed = new Set(types);
    if (!(allowed.has(actual) || (actual === "integer" && allowed.has("number")))) {
      return false;
    }
  }

  if (schema.enum && schema.enum.length > 0) {
    if (!schema.enum.some((entry) => equals(entry, data))) {
      return false;
    }
  }

  if (schema.const !== undefined && !equals(schema.const, data)) {
    return false;
  }

  if (schema.required?.length) {
    if (!isObjectRecord(data)) {
      return false;
    }
    for (const key of schema.required) {
      if (!(key in data)) {
        return false;
      }
    }
  }

  if (schema.properties && isObjectRecord(data)) {
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (data[key] !== undefined && !isDataMatchingSchema(propertySchema, data[key])) {
        return false;
      }
    }
  }

  if (schema.items && Array.isArray(data)) {
    for (const item of data) {
      if (!isDataMatchingSchema(schema.items, item)) {
        return false;
      }
    }
  }

  if (schema.allOf?.length) {
    return schema.allOf.every((subSchema) => isDataMatchingSchema(subSchema, data));
  }

  if (schema.anyOf?.length) {
    return schema.anyOf.some((subSchema) => isDataMatchingSchema(subSchema, data));
  }

  if (schema.oneOf?.length) {
    const matches = schema.oneOf.filter((subSchema) => isDataMatchingSchema(subSchema, data));
    return matches.length === 1;
  }

  return true;
}
