import type { RenderSchemaNode, SchemaPrimitiveType } from "./types.ts";

function normalizeType(value: RenderSchemaNode["type"]): SchemaPrimitiveType[] | undefined {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

function mergeTypes(
  left: RenderSchemaNode["type"],
  right: RenderSchemaNode["type"],
): RenderSchemaNode["type"] | undefined {
  const leftTypes = normalizeType(left);
  const rightTypes = normalizeType(right);

  if (!leftTypes) {
    return right;
  }
  if (!rightTypes) {
    return left;
  }

  const intersection = leftTypes.filter((type) => rightTypes.includes(type));
  if (intersection.length === 0) {
    return undefined;
  }
  if (intersection.length === 1) {
    return intersection[0];
  }
  return [...new Set(intersection)];
}

function mergeNodeArrays(
  left: RenderSchemaNode[] | undefined,
  right: RenderSchemaNode[] | undefined,
): RenderSchemaNode[] | undefined {
  if (!left && !right) {
    return undefined;
  }
  return [...(left ?? []), ...(right ?? [])];
}

function mergeRecords(
  left: Record<string, RenderSchemaNode> | undefined,
  right: Record<string, RenderSchemaNode> | undefined,
): Record<string, RenderSchemaNode> | undefined {
  if (!left && !right) {
    return undefined;
  }
  return {
    ...left,
    ...right,
  };
}

export function mergeSchemaNodes(
  base: RenderSchemaNode,
  override: RenderSchemaNode,
): RenderSchemaNode {
  const merged: RenderSchemaNode = {
    ...base,
    ...override,
  };

  const mergedType = mergeTypes(base.type, override.type);
  if (base.type && override.type && !mergedType) {
    return { type: [] };
  }
  if (mergedType) {
    merged.type = mergedType;
  }

  merged.properties = mergeRecords(base.properties, override.properties);
  merged.patternProperties = mergeRecords(base.patternProperties, override.patternProperties);
  merged.definitions = mergeRecords(base.definitions, override.definitions);
  merged.$defs = mergeRecords(base.$defs, override.$defs);
  merged.dependentSchemas = mergeRecords(base.dependentSchemas, override.dependentSchemas);

  if (base.required || override.required) {
    merged.required = [...new Set([...(base.required ?? []), ...(override.required ?? [])])];
  }

  if (base.dependentRequired || override.dependentRequired) {
    const keys = new Set([
      ...Object.keys(base.dependentRequired ?? {}),
      ...Object.keys(override.dependentRequired ?? {}),
    ]);
    const dependentRequired: Record<string, string[]> = {};
    for (const key of keys) {
      dependentRequired[key] = [
        ...new Set([
          ...(base.dependentRequired?.[key] ?? []),
          ...(override.dependentRequired?.[key] ?? []),
        ]),
      ];
    }
    merged.dependentRequired = dependentRequired;
  }

  merged.allOf = mergeNodeArrays(base.allOf, override.allOf);
  merged.anyOf = mergeNodeArrays(base.anyOf, override.anyOf);
  merged.oneOf = mergeNodeArrays(base.oneOf, override.oneOf);

  return merged;
}

export function safeMergeSchemas(...nodes: RenderSchemaNode[]): RenderSchemaNode | undefined {
  if (nodes.length === 0) {
    return {};
  }
  let merged = structuredClone(nodes[0]);
  for (let index = 1; index < nodes.length; index++) {
    merged = mergeSchemaNodes(merged, nodes[index]);
    if (Array.isArray(merged.type) && merged.type.length === 0) {
      return undefined;
    }
  }
  return merged;
}

export function areSchemasCompatible(...nodes: RenderSchemaNode[]): boolean {
  return Boolean(safeMergeSchemas(...nodes));
}
