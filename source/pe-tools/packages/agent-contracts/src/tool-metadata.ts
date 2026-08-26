import type { ToolsInput } from "@mastra/core/agent";

export type RuntimeToolKind =
  | "read"
  | "search"
  | "fetch"
  | "edit"
  | "delete"
  | "execute"
  | "think"
  | "other";

export interface RuntimeToolMetadata {
  name: string;
  kind: RuntimeToolKind;
}

export type RuntimeToolCatalog = ReadonlyMap<string, RuntimeToolMetadata>;

export function assertRuntimeToolCatalogMatchesTools(
  tools: ToolsInput,
  catalog: RuntimeToolCatalog,
): void {
  const executable = Object.keys(tools).sort();
  const documented = [...catalog.keys()].sort();
  const missing = executable.filter((name) => !catalog.has(name));
  const extra = documented.filter((name) => !(name in tools));
  if (
    missing.length > 0 ||
    extra.length > 0 ||
    documented.some((name) => catalog.get(name)?.name !== name)
  ) {
    throw new Error(
      `Runtime tool catalog mismatch. missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`,
    );
  }
}
