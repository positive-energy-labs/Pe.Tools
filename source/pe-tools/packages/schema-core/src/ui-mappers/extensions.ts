import type {
  FieldHint,
  NormalizedFieldOptionDataset,
  NormalizedFieldOptionDependencyScope,
  NormalizedFieldOptionMode,
  NormalizedFieldOptionResolver,
  NormalizedRenderFieldOptionDependency,
  NormalizedRenderFieldOptionSource,
  NormalizedRenderUiBehavior,
  NormalizedRenderUiLayout,
  NormalizedRenderUiMetadata,
  RenderSchemaNode,
} from "../core/types.ts";

export function normalizeFieldOptionMode(value: unknown): NormalizedFieldOptionMode | undefined {
  const normalized = typeof value === "string" ? value.toLowerCase() : undefined;
  return normalized === "suggestion" || normalized === "constraint" ? normalized : undefined;
}

export function normalizeFieldOptionResolver(
  value: unknown,
): NormalizedFieldOptionResolver | undefined {
  const normalized = typeof value === "string" ? value.toLowerCase() : undefined;
  return normalized === "remote" || normalized === "dataset" ? normalized : undefined;
}

export function normalizeFieldOptionDataset(
  value: unknown,
): NormalizedFieldOptionDataset | undefined {
  const normalized = typeof value === "string" ? value.toLowerCase() : undefined;
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function normalizeFieldOptionDependencyScope(
  value: unknown,
): NormalizedFieldOptionDependencyScope | undefined {
  const normalized = typeof value === "string" ? value.toLowerCase() : undefined;
  return normalized === "sibling" || normalized === "context" ? normalized : undefined;
}

export function getFieldHint(node: RenderSchemaNode): FieldHint {
  // The C# settings schema emits `x-display-name` as the field label; the older
  // `x-field` envelope (label/order/group/placeholder) is a renderer convention.
  // Read both so C#-authored labels actually surface.
  const displayName =
    typeof node["x-display-name"] === "string" ? node["x-display-name"] : undefined;
  const hints = node["x-field"];
  if (!hints || typeof hints !== "object" || Array.isArray(hints)) {
    return displayName ? { label: displayName } : {};
  }

  const candidate = hints as FieldHint;
  return {
    label: (typeof candidate.label === "string" ? candidate.label : undefined) ?? displayName,
    order: typeof candidate.order === "number" ? candidate.order : undefined,
    group: typeof candidate.group === "string" ? candidate.group : undefined,
    placeholder: typeof candidate.placeholder === "string" ? candidate.placeholder : undefined,
  };
}

export function getFieldPlaceholder(node: RenderSchemaNode): string | undefined {
  return getFieldHint(node).placeholder;
}

export function getFieldOrder(node: RenderSchemaNode): number | undefined {
  return getFieldHint(node).order;
}

export function getFieldLabel(path: string, node: RenderSchemaNode): string {
  const hints = getFieldHint(node);
  if (hints.label) {
    return hints.label;
  }

  if (node.title) {
    return node.title;
  }

  const leaf = path.split(".").at(-1) ?? path;
  return leaf.charAt(0).toUpperCase() + leaf.slice(1);
}

export function getDependsOn(node: RenderSchemaNode): string[] {
  const optionSource = getFieldOptionSource(node);
  if (optionSource) {
    return optionSource.dependsOn.map((dependency) => dependency.key);
  }

  const raw = node["x-depends-on"];
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is string => typeof entry === "string");
  }

  if (typeof raw === "string") {
    return [raw];
  }

  return [];
}

export function getFieldOptionSource(
  node: RenderSchemaNode,
): NormalizedRenderFieldOptionSource | undefined {
  const raw = node["x-options"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as unknown as Record<string, unknown>;
  const mode = normalizeFieldOptionMode(candidate.mode);
  const dependsOnRaw = candidate.dependsOn;
  const dependsOn = Array.isArray(dependsOnRaw)
    ? dependsOnRaw.reduce<NormalizedRenderFieldOptionDependency[]>((acc, dependency) => {
        if (!dependency || typeof dependency !== "object" || Array.isArray(dependency)) {
          return acc;
        }

        const normalizedDependency = dependency as Record<string, unknown>;
        if (typeof normalizedDependency.key !== "string") {
          return acc;
        }

        acc.push({
          key: normalizedDependency.key,
          scope: normalizeFieldOptionDependencyScope(normalizedDependency.scope),
        });
        return acc;
      }, [])
    : undefined;

  if (
    typeof candidate.key === "string" &&
    mode &&
    typeof candidate.allowsCustomValue === "boolean" &&
    dependsOn
  ) {
    return {
      key: candidate.key,
      mode,
      resolver: normalizeFieldOptionResolver(candidate.resolver) ?? "remote",
      dataset: normalizeFieldOptionDataset(candidate.dataset),
      allowsCustomValue: candidate.allowsCustomValue,
      dependsOn,
    };
  }

  return undefined;
}

function getUiLayout(raw: unknown): NormalizedRenderUiLayout | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  const section =
    typeof candidate.section === "string" && candidate.section.length > 0
      ? candidate.section
      : undefined;
  const advanced = typeof candidate.advanced === "boolean" ? candidate.advanced : undefined;

  if (section === undefined && advanced === undefined) {
    return undefined;
  }

  return {
    section,
    advanced,
  };
}

function getUiBehavior(raw: unknown): NormalizedRenderUiBehavior | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  const fixedColumns = Array.isArray(candidate.fixedColumns)
    ? candidate.fixedColumns.filter(
        (entry): entry is string => typeof entry === "string" && entry.length > 0,
      )
    : [];
  const dynamicColumnOrderRaw = candidate.dynamicColumnOrder;
  const dynamicColumnOrder =
    dynamicColumnOrderRaw &&
    typeof dynamicColumnOrderRaw === "object" &&
    !Array.isArray(dynamicColumnOrderRaw)
      ? {
          source:
            typeof (dynamicColumnOrderRaw as Record<string, unknown>).source === "string"
              ? ((dynamicColumnOrderRaw as Record<string, unknown>).source as string)
              : undefined,
          values: Array.isArray((dynamicColumnOrderRaw as Record<string, unknown>).values)
            ? ((dynamicColumnOrderRaw as Record<string, unknown>).values as unknown[]).filter(
                (entry): entry is string => typeof entry === "string" && entry.length > 0,
              )
            : [],
        }
      : undefined;
  const dynamicColumnsFromAdditionalProperties =
    typeof candidate.dynamicColumnsFromAdditionalProperties === "boolean"
      ? candidate.dynamicColumnsFromAdditionalProperties
      : undefined;
  const missingValue =
    typeof candidate.missingValue === "string" ? candidate.missingValue : undefined;

  if (
    fixedColumns.length === 0 &&
    dynamicColumnsFromAdditionalProperties === undefined &&
    missingValue === undefined &&
    dynamicColumnOrder === undefined
  ) {
    return undefined;
  }

  return {
    fixedColumns,
    dynamicColumnsFromAdditionalProperties,
    missingValue,
    dynamicColumnOrder,
  };
}

export function getUiMetadata(node: RenderSchemaNode): NormalizedRenderUiMetadata | undefined {
  const raw = node["x-ui"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  const renderer =
    typeof candidate.renderer === "string" && candidate.renderer.length > 0
      ? candidate.renderer
      : undefined;
  const layout = getUiLayout(candidate.layout);
  const behavior = getUiBehavior(candidate.behavior);

  if (renderer === undefined && layout === undefined && behavior === undefined) {
    return undefined;
  }

  return {
    renderer,
    layout,
    behavior,
  };
}

export function getProviderKey(node: RenderSchemaNode): string | undefined {
  const optionSource = getFieldOptionSource(node);
  if (optionSource) {
    return optionSource.key;
  }

  const provider = node["x-provider"];
  return typeof provider === "string" ? provider : undefined;
}

export function readPathValue(input: unknown, path: string): unknown {
  if (!path) {
    return input;
  }

  const parts = path.split(".");
  let cursor: unknown = input;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  return cursor;
}
