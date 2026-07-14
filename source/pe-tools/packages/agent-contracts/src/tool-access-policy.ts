import type { AgentControllerRequestContext, ToolCategory } from "@mastra/core/agent-controller";
import {
  resolveRuntimeToolMetadata,
  type RuntimeToolKind,
  type RuntimeToolMetadata,
  type RuntimeToolSource,
  type RuntimeToolsInput,
} from "./tool-metadata.ts";

export type RuntimeAccessLevel = "read-only" | "ask" | "trusted";

export class RuntimeToolAccessError extends Error {
  constructor(toolName: string, kind: RuntimeToolKind, accessLevel: RuntimeAccessLevel) {
    super(
      `Tool '${toolName}' is not allowed while access level is ${accessLevel}. Tool kind '${kind}' requires a higher access level.`,
    );
    this.name = "RuntimeToolAccessError";
  }
}

export function guardRuntimeToolsForAccessPolicy(
  tools: RuntimeToolsInput,
  toolCatalog?: RuntimeToolSource,
): RuntimeToolsInput {
  const guarded = { ...tools };
  for (const [toolName, tool] of Object.entries(guarded)) {
    guarded[toolName] = guardRuntimeToolForAccessPolicy(toolName, tool, toolCatalog);
  }
  return guarded;
}

export function isRuntimeToolAllowedForAccessLevel(options: {
  metadata?: RuntimeToolMetadata;
  accessLevel?: RuntimeAccessLevel;
}): boolean {
  if (options.accessLevel !== "read-only") return true;
  const kind = options.metadata?.kind;
  if (!kind) return true;
  return readOnlyToolKinds.has(kind);
}

export function assertRuntimeToolAccess(options: {
  toolName: string;
  metadata?: RuntimeToolMetadata;
  accessLevel?: RuntimeAccessLevel;
}): void {
  if (isRuntimeToolAllowedForAccessLevel(options)) return;
  const kind = options.metadata?.kind;
  if (!kind) return;
  throw new RuntimeToolAccessError(options.toolName, kind, options.accessLevel ?? "ask");
}

const readOnlyToolKinds = new Set<RuntimeToolKind>(["read", "search", "fetch", "think"]);

/** Pe tool `kind` → mastra permission {@link ToolCategory}. Read-only kinds collapse to "read" so
 * the "ask" access level auto-allows them; mutating kinds keep their own category (→ "ask"). */
const toolKindToCategory: Record<RuntimeToolKind, ToolCategory> = {
  read: "read",
  search: "read",
  fetch: "read",
  think: "read",
  edit: "edit",
  delete: "edit",
  execute: "execute",
  other: "other",
};

// ponytail: workspace builtins (mastra_workspace_*) ship without Pe catalog metadata; match the
// read-only ones by suffix so "ask" doesn't gate a plain list/read/grep. Anything unmatched returns
// null → mastra falls back to "ask" (the safe default).
const readOnlyWorkspaceToolPattern = /(read_file|list_files|file_stat|grep|glob|find_files)$/;

/**
 * Map a tool name to its mastra permission category from the runtime catalog `kind`, falling back
 * to a name match for uncatalogued workspace read builtins. Wired into the AgentController as
 * `toolCategoryResolver`; paired with a `permissionRules.categories.read = "allow"` seed this is what
 * lets the "ask" access level gate only state-changing tools instead of every tool.
 */
export function createRuntimeToolCategoryResolver(
  toolCatalog: RuntimeToolSource | undefined,
): (toolName: string) => ToolCategory | null {
  return (toolName) => {
    const kind = resolveRuntimeToolMetadata(toolCatalog, toolName)?.kind;
    if (kind) return toolKindToCategory[kind];
    if (readOnlyWorkspaceToolPattern.test(toolName)) return "read";
    return null;
  };
}

type RuntimeToolInput = RuntimeToolsInput[string];

type RuntimeExecutableTool = {
  execute: (input: unknown, context: unknown) => unknown;
};

function guardRuntimeToolForAccessPolicy(
  toolName: string,
  tool: RuntimeToolInput,
  toolCatalog?: RuntimeToolSource,
): RuntimeToolInput {
  if (!isRuntimeExecutableTool(tool)) return tool;

  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (input: unknown, context: unknown) => {
      assertRuntimeToolAccess({
        toolName,
        metadata: resolveRuntimeToolMetadata(toolCatalog, toolName),
        accessLevel: readRuntimeAccessLevelFromToolContext(context),
      });
      return await execute(input, context);
    },
  };
}

export function readRuntimeAccessLevelFromToolContext(
  context: unknown,
): RuntimeAccessLevel | undefined {
  const requestContext = readRequestContext(readRecord(context).requestContext);
  const controller = requestContext?.get("controller") as
    | AgentControllerRequestContext<{ accessLevel?: unknown; yolo?: unknown }>
    | undefined;
  if (!controller) return undefined;
  const state =
    typeof controller.getState === "function" ? controller.getState() : controller.state;
  return readAccessLevelFromState(state);
}

function readAccessLevelFromState(state: unknown): RuntimeAccessLevel | undefined {
  const stateRecord = readRecord(state);
  const accessLevel = stateRecord.accessLevel;
  if (accessLevel === "read-only" || accessLevel === "ask" || accessLevel === "trusted") {
    return accessLevel;
  }
  if (stateRecord.yolo === true) return "trusted";
  if (stateRecord.yolo === false) return "ask";
  return undefined;
}

function readRequestContext(value: unknown): { get: (key: string) => unknown } | undefined {
  return hasRequestContextGetter(value) ? { get: (key) => value.get(key) } : undefined;
}

function hasRequestContextGetter(value: unknown): value is { get: (key: string) => unknown } {
  return isRecord(value) && typeof value.get === "function";
}

function isRuntimeExecutableTool(
  value: unknown,
): value is RuntimeToolInput & RuntimeExecutableTool {
  return isRecord(value) && typeof value.execute === "function";
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
