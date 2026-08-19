import { buildDefaultValuesFromSchema, applySchemaDefaultsToValue } from "../core/defaults.ts";
import { dataAt } from "../core/data-at-path.ts";
import {
  resolveEffectiveNode,
  resolveEffectiveNodeAtPath,
  resolveNodeType,
} from "../core/effective-node.ts";
import { parsePathString } from "../core/path-utils.ts";
import type { Path } from "../core/path.ts";
import { preprocessSchema } from "../core/preprocess.ts";
import type {
  FieldHint,
  NormalizedRenderFieldOptionDependency,
  NormalizedRenderFieldOptionSource,
  NormalizedRenderUiMetadata,
  RenderSchemaNode,
  SchemaPrimitiveType,
} from "../core/types.ts";
import {
  getDependsOn,
  getFieldHint,
  getFieldLabel,
  getFieldOptionSource,
  getFieldOrder,
  getFieldPlaceholder,
  getProviderKey,
  getUiMetadata,
} from "../ui-mappers/extensions.ts";

function pathToString(path: Path): string {
  return path.map(String).join(".");
}

function sortPropertyEntries(
  properties: Record<string, RenderSchemaNode>,
): Array<[string, RenderSchemaNode]> {
  return Object.entries(properties).sort(([aKey, aNode], [bKey, bNode]) => {
    const aOrder = getFieldOrder(aNode) ?? 10_000;
    const bOrder = getFieldOrder(bNode) ?? 10_000;

    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    return aKey.localeCompare(bKey);
  });
}

export class SchemaNodeRef {
  private sortedChildrenCache?: Array<[string, SchemaNodeRef]>;
  private fieldHintCache?: FieldHint;
  private optionSourceCache?: NormalizedRenderFieldOptionSource | undefined;
  private uiMetadataCache?: NormalizedRenderUiMetadata | undefined;

  constructor(
    private readonly documentRef: SchemaDocument,
    private readonly segments: Path,
    private readonly node: RenderSchemaNode,
  ) {}

  document() {
    return this.documentRef;
  }

  raw(): RenderSchemaNode {
    return this.node;
  }

  pathSegments(): Path {
    return [...this.segments];
  }

  path(): string {
    return pathToString(this.segments);
  }

  effective(data?: unknown): SchemaNodeRef {
    return this.documentRef.ref(
      this.segments,
      resolveEffectiveNode(this.node, this.documentRef.rawRoot(), data),
    );
  }

  effectiveAt(dataRoot: unknown): SchemaNodeRef | undefined {
    return this.documentRef.resolveAt(this.segments, dataRoot);
  }

  kind(): SchemaPrimitiveType | undefined {
    return resolveNodeType(this.node) as SchemaPrimitiveType | undefined;
  }

  fieldHint(): FieldHint {
    if (!this.fieldHintCache) {
      this.fieldHintCache = getFieldHint(this.node);
    }

    return this.fieldHintCache;
  }

  label(): string {
    return getFieldLabel(this.path(), this.node);
  }

  placeholder(): string | undefined {
    return getFieldPlaceholder(this.node);
  }

  order(): number | undefined {
    return getFieldOrder(this.node);
  }

  description(): string | undefined {
    return this.node.description;
  }

  isRequired(): boolean {
    const parent = this.parent();
    const leaf = this.segments.at(-1);
    if (!parent || typeof leaf !== "string") {
      return false;
    }

    return parent.raw().required?.includes(leaf) ?? false;
  }

  hasExplicitDefault(): boolean {
    return this.node.default !== undefined;
  }

  explicitDefault(): unknown {
    return this.node.default;
  }

  optionSource(): NormalizedRenderFieldOptionSource | undefined {
    if (this.optionSourceCache === undefined) {
      this.optionSourceCache = getFieldOptionSource(this.node);
    }

    return this.optionSourceCache;
  }

  uiMetadata(): NormalizedRenderUiMetadata | undefined {
    if (this.uiMetadataCache === undefined) {
      this.uiMetadataCache = getUiMetadata(this.node);
    }

    return this.uiMetadataCache;
  }

  dependencies(): NormalizedRenderFieldOptionDependency[] {
    return this.optionSource()?.dependsOn ?? [];
  }

  dependencyKeys(): string[] {
    return getDependsOn(this.node);
  }

  providerKey(): string | undefined {
    return getProviderKey(this.node);
  }

  hasRemoteOptions(): boolean {
    return this.optionSource()?.resolver === "remote";
  }

  hasInlineSuggestions(): boolean {
    return Array.isArray(this.node.examples) && this.node.examples.length > 0;
  }

  isEnumLike(): boolean {
    return Array.isArray(this.node.enum) && this.node.enum.length > 0;
  }

  child(key: string): SchemaNodeRef | undefined {
    const childNode = this.node.properties?.[key];
    if (!childNode) {
      return undefined;
    }

    return this.documentRef.ref([...this.segments, key], childNode);
  }

  item(): SchemaNodeRef | undefined {
    if (!this.node.items) {
      return undefined;
    }

    return this.documentRef.ref([...this.segments, 0], this.node.items);
  }

  parent(): SchemaNodeRef | undefined {
    if (this.segments.length === 0) {
      return undefined;
    }

    return this.documentRef.tryAt(this.segments.slice(0, -1));
  }

  sortedProperties(): Array<[string, SchemaNodeRef]> {
    if (!this.sortedChildrenCache) {
      const properties = this.node.properties ?? {};
      this.sortedChildrenCache = sortPropertyEntries(properties).map(([key, childNode]) => [
        key,
        this.documentRef.ref([...this.segments, key], childNode),
      ]);
    }

    return this.sortedChildrenCache;
  }

  defaultValue(): unknown {
    return buildDefaultValuesFromSchema(this.node, this.documentRef.rawRoot());
  }

  applyDefaults(value: unknown): unknown {
    return applySchemaDefaultsToValue(this.node, value, this.documentRef.rawRoot());
  }

  providerPath(): string {
    return this.documentRef.toProviderPath(this.segments);
  }
}

export class SchemaDocument {
  private readonly refCache = new Map<string, SchemaNodeRef>();
  private readonly rootRef: SchemaNodeRef;

  private constructor(private readonly schemaRoot: RenderSchemaNode) {
    this.rootRef = this.ref([], schemaRoot);
  }

  static from(root: RenderSchemaNode): SchemaDocument {
    return new SchemaDocument(preprocessSchema(root));
  }

  static parse(schemaJson: string): SchemaDocument | undefined {
    try {
      return SchemaDocument.from(JSON.parse(schemaJson) as RenderSchemaNode);
    } catch {
      return undefined;
    }
  }

  rawRoot(): RenderSchemaNode {
    return this.schemaRoot;
  }

  root(): SchemaNodeRef {
    return this.rootRef;
  }

  ref(path: string | Path, node: RenderSchemaNode): SchemaNodeRef {
    const segments = Array.isArray(path) ? [...path] : parsePathString(path);
    const key = pathToString(segments);
    const existing = this.refCache.get(key);
    if (existing && existing.raw() === node) {
      return existing;
    }

    const created = new SchemaNodeRef(this, segments, node);
    this.refCache.set(key, created);
    return created;
  }

  at(path: string | Path): SchemaNodeRef {
    const ref = this.tryAt(path);
    if (!ref) {
      throw new Error(
        `Schema node not found at path "${pathToString(Array.isArray(path) ? path : parsePathString(path))}".`,
      );
    }

    return ref;
  }

  tryAt(path: string | Path): SchemaNodeRef | undefined {
    const segments = Array.isArray(path) ? [...path] : parsePathString(path);
    let cursor: RenderSchemaNode | undefined = this.schemaRoot;

    for (const segment of segments) {
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

      if (
        cursor.additionalProperties &&
        typeof cursor.additionalProperties === "object" &&
        !Array.isArray(cursor.additionalProperties)
      ) {
        cursor = cursor.additionalProperties;
        continue;
      }

      return undefined;
    }

    return cursor ? this.ref(segments, cursor) : undefined;
  }

  resolveAt(path: string | Path, dataRoot: unknown): SchemaNodeRef | undefined {
    const segments = Array.isArray(path) ? [...path] : parsePathString(path);
    const resolved = resolveEffectiveNodeAtPath(this.schemaRoot, segments, dataRoot);
    return resolved ? this.ref(segments, resolved) : undefined;
  }

  valueAt(dataRoot: unknown, path: string | Path): unknown {
    const segments = Array.isArray(path) ? path : parsePathString(path);
    return dataAt(segments, dataRoot);
  }

  toProviderPath(path: string | Path): string {
    const segments = Array.isArray(path) ? path : parsePathString(path);
    return segments.map((segment) => (typeof segment === "number" ? "items" : segment)).join(".");
  }
}
