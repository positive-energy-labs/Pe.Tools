import { resolveEffectiveNode, resolveNodeType } from "./effective-node.ts";
import type { RenderSchemaNode } from "./types.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.getPrototypeOf(value) === Object.prototype;
}

function areValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null || left === undefined || right === undefined) {
    return false;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => areValuesEqual(value, right[index]));
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) {
        return false;
      }
      if (!areValuesEqual(left[key], right[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function buildDefaultsFromNode(
  node: RenderSchemaNode | undefined,
  schemaRoot: RenderSchemaNode,
): unknown {
  if (!node) {
    return {};
  }

  const effectiveNode = resolveEffectiveNode(node, schemaRoot);
  if (effectiveNode.default !== undefined) {
    return effectiveNode.default;
  }

  const nodeType = resolveNodeType(effectiveNode);
  if (nodeType === "object") {
    const output: Record<string, unknown> = {};
    const properties = effectiveNode.properties ?? {};

    for (const [key, child] of Object.entries(properties)) {
      output[key] = buildDefaultsFromNode(child, schemaRoot);
    }

    return output;
  }

  if (nodeType === "array") {
    return Array.isArray(effectiveNode.default) ? effectiveNode.default : [];
  }

  if (nodeType === "boolean") {
    return false;
  }

  if (nodeType === "number" || nodeType === "integer") {
    return 0;
  }

  return "";
}

export function buildDefaultValuesFromSchema(
  node: RenderSchemaNode | undefined,
  schemaRoot?: RenderSchemaNode,
): unknown {
  const root = schemaRoot ?? node;
  if (!node || !root) {
    return {};
  }

  return buildDefaultsFromNode(node, root);
}

export function applySchemaDefaultsToValue(
  node: RenderSchemaNode | undefined,
  value: unknown,
  schemaRoot?: RenderSchemaNode,
): unknown {
  const root = schemaRoot ?? node;
  if (!node || !root) {
    return value;
  }

  const effectiveNode = resolveEffectiveNode(node, root, value);
  const nodeType = resolveNodeType(effectiveNode);

  if (value === undefined || value === null) {
    return buildDefaultValuesFromSchema(effectiveNode, root);
  }

  if (nodeType === "object") {
    if (typeof value !== "object" || Array.isArray(value)) {
      return buildDefaultValuesFromSchema(effectiveNode, root);
    }

    const source = value as Record<string, unknown>;
    const properties = effectiveNode.properties ?? {};
    const result: Record<string, unknown> = {};

    for (const [key, childNode] of Object.entries(properties)) {
      result[key] = applySchemaDefaultsToValue(childNode, source[key], root);
    }

    for (const [key, rawValue] of Object.entries(source)) {
      if (!(key in result)) {
        result[key] = rawValue;
      }
    }

    return result;
  }

  if (nodeType === "array") {
    if (!Array.isArray(value)) {
      return buildDefaultValuesFromSchema(effectiveNode, root);
    }

    if (!effectiveNode.items) {
      return value;
    }

    return value.map((item) => applySchemaDefaultsToValue(effectiveNode.items, item, root));
  }

  return value;
}

function resolveExplicitDefault(effectiveNode: RenderSchemaNode): {
  hasDefault: boolean;
  value: unknown;
} {
  if ("default" in effectiveNode) {
    return { hasDefault: true, value: effectiveNode.default };
  }

  return { hasDefault: false, value: undefined };
}

export function removeSchemaDefaultsFromValue(
  node: RenderSchemaNode | undefined,
  value: unknown,
  schemaRoot?: RenderSchemaNode,
): unknown {
  const root = schemaRoot ?? node;
  if (!node || !root) {
    return value;
  }

  const effectiveNode = resolveEffectiveNode(node, root, value);
  const nodeType = resolveNodeType(effectiveNode);
  const { hasDefault, value: explicitDefault } = resolveExplicitDefault(effectiveNode);
  const computedDefault = buildDefaultValuesFromSchema(effectiveNode, root);

  if (nodeType !== "object") {
    const defaultValue = hasDefault ? explicitDefault : computedDefault;
    if (areValuesEqual(value, defaultValue)) {
      return undefined;
    }
  } else if (hasDefault && areValuesEqual(value, explicitDefault)) {
    return undefined;
  }

  if (nodeType === "object") {
    if (!isPlainObject(value)) {
      return value;
    }

    const properties = effectiveNode.properties ?? {};
    const result: Record<string, unknown> = {};

    for (const [key, childNode] of Object.entries(properties)) {
      const childValue = value[key];
      const pruned = removeSchemaDefaultsFromValue(childNode, childValue, root);
      if (pruned !== undefined) {
        result[key] = pruned;
      }
    }

    for (const [key, rawValue] of Object.entries(value)) {
      if (!(key in result)) {
        result[key] = rawValue;
      }
    }

    return result;
  }

  if (nodeType === "array") {
    if (!Array.isArray(value)) {
      return value;
    }

    if (!effectiveNode.items) {
      return value;
    }

    return value.map((item) => {
      const pruned = removeSchemaDefaultsFromValue(effectiveNode.items, item, root);
      return pruned === undefined ? item : pruned;
    });
  }

  return value;
}
