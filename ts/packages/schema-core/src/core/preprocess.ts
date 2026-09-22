import type { RenderSchemaNode } from "./types.ts";

function isObjectNode(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneNode<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return structuredClone(value);
}

function induceTitles(record: Record<string, RenderSchemaNode> | undefined) {
  if (!record) {
    return;
  }
  for (const [key, node] of Object.entries(record)) {
    if (!node.title) {
      node.title = key;
    }
  }
}

function preprocessRecursive(node: RenderSchemaNode | undefined): void {
  if (!node) {
    return;
  }

  induceTitles(node.properties);
  induceTitles(node.definitions);
  induceTitles(node.$defs);

  if (!node.type && node.properties) {
    node.type = "object";
  }

  if (node.const !== undefined) {
    node.enum = [node.const];
    delete node.const;
  }

  const childrenRecords = [
    node.properties,
    node.patternProperties,
    node.definitions,
    node.$defs,
    node.dependentSchemas,
  ];
  for (const record of childrenRecords) {
    if (!record) {
      continue;
    }
    for (const child of Object.values(record)) {
      preprocessRecursive(child);
    }
  }

  const childArrays = [node.allOf, node.oneOf, node.anyOf];
  for (const children of childArrays) {
    if (!children) {
      continue;
    }
    for (const child of children) {
      preprocessRecursive(child);
    }
  }

  preprocessRecursive(node.items);
  preprocessRecursive(node.if);
  preprocessRecursive(node.then);
  preprocessRecursive(node.else);
}

export function preprocessSchema(root: RenderSchemaNode): RenderSchemaNode {
  const copy = cloneNode(root);
  preprocessRecursive(copy);
  return copy;
}

export function isSchemaObject(value: unknown): value is RenderSchemaNode {
  return isObjectNode(value);
}
