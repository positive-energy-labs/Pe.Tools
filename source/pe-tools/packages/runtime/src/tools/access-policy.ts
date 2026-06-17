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

export function guardRuntimeToolsForAccessPolicy<TTools extends RuntimeToolsInput>(
  tools: TTools,
  toolCatalog?: RuntimeToolSource,
): TTools {
  const guarded = Object.fromEntries(
    Object.entries(tools as Record<string, unknown>).map(([toolName, tool]) => [
      toolName,
      guardRuntimeToolForAccessPolicy(toolName, tool, toolCatalog),
    ]),
  );
  return guarded as TTools;
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

type RuntimeExecutableTool = {
  execute: (input: unknown, context: unknown) => unknown;
};

function guardRuntimeToolForAccessPolicy(
  toolName: string,
  tool: unknown,
  toolCatalog?: RuntimeToolSource,
): unknown {
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
  const contextRecord = readRecord(context);
  const requestContext = readRequestContext(contextRecord.requestContext);
  const harness = readRecord(contextRecord.harness ?? requestContext?.get("harness"));
  return readAccessLevelFromState(readHarnessState(harness));
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

function readHarnessState(harness: Record<string, unknown>): unknown {
  const getState = harness.getState;
  if (typeof getState === "function") return getState.call(harness);
  return harness.state;
}

function readRequestContext(value: unknown): { get: (key: string) => unknown } | undefined {
  const record = readRecord(value);
  return typeof record.get === "function"
    ? { get: (key) => (record.get as (key: string) => unknown).call(value, key) }
    : undefined;
}

function isRuntimeExecutableTool(value: unknown): value is RuntimeExecutableTool {
  return Boolean(
    value && typeof value === "object" && typeof readRecord(value).execute === "function",
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
