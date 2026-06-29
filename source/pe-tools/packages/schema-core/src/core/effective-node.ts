import { dataAt } from "./data-at-path.ts";
import { areSchemasCompatible, safeMergeSchemas } from "./merge.ts";
import { isDataMatchingSchema } from "./matcher.ts";
import { jsonPointerToPathTyped, parsePathString } from "./path-utils.ts";
import type { Path } from "./path.ts";
import type { RenderSchemaNode, SchemaPrimitiveType } from "./types.ts";

function normalizeTypeList(value: RenderSchemaNode["type"]): SchemaPrimitiveType[] | undefined {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

function getRefTarget(root: RenderSchemaNode, ref: string): RenderSchemaNode | undefined {
  if (!ref.startsWith("#/")) {
    return undefined;
  }
  const path = jsonPointerToPathTyped(ref);
  const value = dataAt(path, root);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as RenderSchemaNode;
}

function resolveRefNode(node: RenderSchemaNode, root: RenderSchemaNode): RenderSchemaNode {
  if (!node.$ref) {
    return node;
  }

  const target = getRefTarget(root, node.$ref);
  if (!target) {
    return node;
  }

  const withoutRef: RenderSchemaNode = { ...node };
  delete withoutRef.$ref;
  return safeMergeSchemas(target, withoutRef) ?? node;
}

function resolveAllOf(node: RenderSchemaNode, root: RenderSchemaNode): RenderSchemaNode {
  if (!node.allOf?.length) {
    return node;
  }

  const base = { ...node };
  delete base.allOf;

  const resolvedEntries = node.allOf.map((entry) => resolveComposition(entry, root, undefined, 1));
  return safeMergeSchemas(base, ...resolvedEntries) ?? node;
}

function filterCompatibleSubSchemas(
  nodeWithoutComposite: RenderSchemaNode,
  candidates: RenderSchemaNode[],
): RenderSchemaNode[] {
  return candidates.filter((entry) => areSchemasCompatible(nodeWithoutComposite, entry));
}

function pickBestComposite(
  candidates: RenderSchemaNode[],
  data: unknown,
): RenderSchemaNode | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  const exact = candidates.find((entry) => isDataMatchingSchema(entry, data));
  return exact ?? candidates[0];
}

function resolveAnyOf(
  node: RenderSchemaNode,
  root: RenderSchemaNode,
  data: unknown,
): RenderSchemaNode {
  if (!node.anyOf?.length) {
    return node;
  }

  const base = { ...node };
  delete base.anyOf;

  const options = node.anyOf.map((entry) => resolveComposition(entry, root, data, 1));
  const compatible = filterCompatibleSubSchemas(base, options);
  const picked = pickBestComposite(compatible, data);
  if (!picked) {
    return base;
  }
  return safeMergeSchemas(base, picked) ?? base;
}

function resolveOneOf(
  node: RenderSchemaNode,
  root: RenderSchemaNode,
  data: unknown,
): RenderSchemaNode {
  if (!node.oneOf?.length) {
    return node;
  }

  const base = { ...node };
  delete base.oneOf;

  const options = node.oneOf.map((entry) => resolveComposition(entry, root, data, 1));
  const compatible = filterCompatibleSubSchemas(base, options);
  const picked = pickBestComposite(compatible, data);
  if (!picked) {
    return base;
  }
  return safeMergeSchemas(base, picked) ?? base;
}

function resolveDependentRequired(node: RenderSchemaNode, data: unknown): RenderSchemaNode {
  if (!node.dependentRequired || !data || typeof data !== "object") {
    return node;
  }

  const source = data as Record<string, unknown>;
  const required = new Set(node.required ?? []);

  for (const [propertyKey, dependent] of Object.entries(node.dependentRequired)) {
    if (source[propertyKey] !== undefined) {
      for (const key of dependent) {
        required.add(key);
      }
    }
  }

  return {
    ...node,
    required: [...required],
  };
}

function resolveDependentSchemas(
  node: RenderSchemaNode,
  root: RenderSchemaNode,
  data: unknown,
): RenderSchemaNode {
  if (!node.dependentSchemas || !data || typeof data !== "object") {
    return node;
  }

  const source = data as Record<string, unknown>;
  const toMerge: RenderSchemaNode[] = [];
  for (const [propertyKey, schema] of Object.entries(node.dependentSchemas)) {
    if (source[propertyKey] !== undefined) {
      toMerge.push(resolveComposition(schema, root, data, 1));
    }
  }

  if (toMerge.length === 0) {
    return node;
  }
  return safeMergeSchemas(node, ...toMerge) ?? node;
}

function resolveIfThenElse(
  node: RenderSchemaNode,
  root: RenderSchemaNode,
  data: unknown,
): RenderSchemaNode {
  if (!node.if) {
    return node;
  }

  const base: RenderSchemaNode = { ...node };
  delete base.if;
  delete base.then;
  delete base.else;

  const condition = resolveComposition(node.if, root, data, 1);
  const thenNode = node.then ? resolveComposition(node.then, root, data, 1) : {};
  const elseNode = node.else ? resolveComposition(node.else, root, data, 1) : {};

  const branch = isDataMatchingSchema(condition, data) ? thenNode : elseNode;
  return safeMergeSchemas(base, branch) ?? base;
}

function resolveTypeUnion(node: RenderSchemaNode, root: RenderSchemaNode): RenderSchemaNode {
  const types = normalizeTypeList(node.type);
  if (!types || types.length <= 1) {
    return node;
  }

  const firstNonNullType = types.find((type) => type !== "null") ?? types[0];
  const base = { ...node, type: firstNonNullType };
  return resolveComposition(base, root, undefined, 1);
}

function resolveComposition(
  node: RenderSchemaNode,
  root: RenderSchemaNode,
  data: unknown,
  depth: number,
): RenderSchemaNode {
  if (depth > 20) {
    return node;
  }

  let current = { ...node };

  current = resolveRefNode(current, root);
  current = resolveAllOf(current, root);
  current = resolveOneOf(current, root, data);
  current = resolveAnyOf(current, root, data);
  current = resolveTypeUnion(current, root);

  return current;
}

export function resolveEffectiveNode(
  node: RenderSchemaNode,
  schemaRoot: RenderSchemaNode,
  data?: unknown,
): RenderSchemaNode {
  let current = resolveComposition(node, schemaRoot, data, 0);
  let iterations = 0;

  while (iterations < 10) {
    const next = resolveDependentSchemas(
      resolveDependentRequired(resolveIfThenElse(current, schemaRoot, data), data),
      schemaRoot,
      data,
    );

    const before = JSON.stringify(current);
    const after = JSON.stringify(next);
    current = resolveComposition(next, schemaRoot, data, 0);

    if (before === after) {
      break;
    }
    iterations += 1;
  }

  return current;
}

function subSchemaAtPath(root: RenderSchemaNode, path: Path): RenderSchemaNode | undefined {
  let cursor: RenderSchemaNode | undefined = root;
  for (const segment of path) {
    if (!cursor) {
      return undefined;
    }

    if (typeof segment === "number") {
      cursor = cursor.items;
      continue;
    }

    if (cursor.properties?.[segment]) {
      cursor = cursor.properties[segment];
      continue;
    }

    if (cursor.additionalProperties && typeof cursor.additionalProperties === "object") {
      cursor = cursor.additionalProperties;
      continue;
    }

    cursor = undefined;
  }
  return cursor;
}

export function resolveEffectiveNodeAtPath(
  schemaRoot: RenderSchemaNode,
  path: string | Path,
  dataRoot: unknown,
): RenderSchemaNode | undefined {
  const parsedPath = Array.isArray(path) ? path : parsePathString(path);

  let currentSchema = resolveEffectiveNode(schemaRoot, schemaRoot, dataRoot);
  if (parsedPath.length === 0) {
    return currentSchema;
  }

  const walkedPath: Path = [];
  for (const segment of parsedPath) {
    walkedPath.push(segment);
    const nextRaw = subSchemaAtPath(currentSchema, [segment]);
    if (!nextRaw) {
      return undefined;
    }
    const nodeData = dataAt(walkedPath, dataRoot);
    currentSchema = resolveEffectiveNode(nextRaw, schemaRoot, nodeData);
  }

  return currentSchema;
}

export function resolveNodeType(node: RenderSchemaNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  if (typeof node.type === "string") {
    return node.type;
  }

  if (Array.isArray(node.type)) {
    const firstDefined = node.type.find((entry) => entry !== "null");
    if (firstDefined) {
      return firstDefined;
    }
  }

  if (node.properties) {
    return "object";
  }

  if (node.items) {
    return "array";
  }

  return undefined;
}
