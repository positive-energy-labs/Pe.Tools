import type { AgentControllerRequestContext } from "@mastra/core/agent-controller";
import type { RuntimeAccessLevel } from "../runtime.ts";
import {
  resolveRuntimeToolMetadata,
  type RuntimeToolKind,
  type RuntimeToolMetadata,
  type RuntimeToolSource,
  type RuntimeToolsInput,
} from "../tool-metadata.ts";

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
