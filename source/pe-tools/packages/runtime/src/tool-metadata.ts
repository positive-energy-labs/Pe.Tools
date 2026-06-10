import type { HarnessConfig } from "@mastra/core/harness";

export type RuntimeToolKind =
  | "read"
  | "search"
  | "fetch"
  | "edit"
  | "delete"
  | "execute"
  | "think"
  | "other";

export type RuntimeToolProvenanceSource =
  | "workspace"
  | "harness"
  | "app"
  | "mcp"
  | "skill"
  | "browser"
  | "unknown";

export interface RuntimeToolProvenance {
  source: RuntimeToolProvenanceSource;
  label?: string;
}

export interface RuntimeToolMetadata {
  name: string;
  canonicalName?: string;
  title?: string;
  kind?: RuntimeToolKind;
  provenance?: RuntimeToolProvenance;
}

export type RuntimeToolCatalog = ReadonlyMap<string, RuntimeToolMetadata>;
export type RuntimeToolResolver = (toolName: string) => RuntimeToolMetadata | undefined;
export type RuntimeToolSource = RuntimeToolCatalog | RuntimeToolResolver;
export type RuntimeToolsInput = NonNullable<HarnessConfig<Record<string, unknown>>["tools"]>;

export interface RuntimeCommandProfile<TCommand = unknown, TOptions = never> {
  createRootCommand?: (options?: TOptions) => TCommand;
  createSubCommands?: (options?: TOptions) => Record<string, TCommand>;
}

export interface RuntimeToolProfile<
  TTools extends RuntimeToolsInput = RuntimeToolsInput,
  TCommand = unknown,
  TOptions = never,
> {
  id: string;
  tools: TTools;
  catalog: RuntimeToolCatalog;
  commands?: RuntimeCommandProfile<TCommand, TOptions>;
}

export type RuntimeToolMetadataInput = Omit<RuntimeToolMetadata, "name"> & {
  name?: string;
};

export type RuntimeToolCatalogInput =
  | Iterable<RuntimeToolMetadata>
  | Readonly<Record<string, RuntimeToolMetadataInput>>;

export function createRuntimeToolCatalog(input: RuntimeToolCatalogInput): RuntimeToolCatalog {
  const catalog = new Map<string, RuntimeToolMetadata>();
  if (isIterable(input)) {
    for (const tool of input) catalog.set(tool.name, normalizeRuntimeToolMetadata(tool.name, tool));
    return catalog;
  }

  for (const [name, tool] of Object.entries(input)) {
    catalog.set(name, normalizeRuntimeToolMetadata(name, tool));
  }
  return catalog;
}

export function createRuntimeToolProfile<
  TTools extends RuntimeToolsInput,
  TCommand = unknown,
  TOptions = never,
>(
  profile: RuntimeToolProfile<TTools, TCommand, TOptions>,
): RuntimeToolProfile<TTools, TCommand, TOptions> {
  return profile;
}

export function mergeRuntimeToolCatalogs(
  ...catalogs: Array<RuntimeToolCatalog | undefined>
): RuntimeToolCatalog {
  const merged = new Map<string, RuntimeToolMetadata>();
  for (const catalog of catalogs) {
    if (!catalog) continue;
    for (const [name, metadata] of catalog) merged.set(name, metadata);
  }
  return merged;
}

export function resolveRuntimeToolMetadata(
  source: RuntimeToolSource | undefined,
  toolName: string | undefined,
): RuntimeToolMetadata | undefined {
  if (!source || !toolName) return undefined;
  const metadata = typeof source === "function" ? source(toolName) : source.get(toolName);
  return metadata ? normalizeRuntimeToolMetadata(toolName, metadata) : undefined;
}

export function runtimeToolTitle(toolName: string, tool?: RuntimeToolMetadata): string {
  return tool?.title ?? titleFromToolName(toolName);
}

function normalizeRuntimeToolMetadata(
  name: string,
  tool: RuntimeToolMetadataInput | RuntimeToolMetadata,
): RuntimeToolMetadata {
  return {
    ...tool,
    name: tool.name ?? name,
  };
}

function titleFromToolName(toolName: string): string {
  return (
    toolName
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Tool Call"
  );
}

function isIterable(value: RuntimeToolCatalogInput): value is Iterable<RuntimeToolMetadata> {
  return typeof (value as Iterable<RuntimeToolMetadata>)[Symbol.iterator] === "function";
}
