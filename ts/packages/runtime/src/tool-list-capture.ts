import type { MastraModelConfig } from "@mastra/core/llm";

export interface ToolListSummaryEntry {
  name?: string;
  type?: string;
  id?: string;
  /** Tool description (first line of the schema body) — the World inspector item preview. */
  description?: string;
  /** char/4 estimate of the serialized tool definition — the bytes it costs in-context. */
  approxTokens?: number;
}

export interface ToolListSnapshot {
  /** The exact tool list handed to the provider on the most recent model call. */
  tools: ToolListSummaryEntry[];
  updatedAt?: string;
}

export interface ToolListCapture {
  /**
   * Mutable snapshot updated in place on each provider call. Point
   * `metadata.workbench.toolList` at this same object so the workbench reads the
   * latest tool list by reference (same trick as `createSystemPromptCapture`).
   */
  snapshot: ToolListSnapshot;
  /**
   * Wrap the agent's resolved model so each provider call records its tool list.
   * Non-model configs (model-id strings, router configs) pass through untouched,
   * so this is safe to apply to any `MastraModelConfig`.
   */
  wrap: (model: MastraModelConfig) => MastraModelConfig;
}

type ToolCallArgs = { tools?: unknown; toolChoice?: unknown };
type ModelCall = (args: ToolCallArgs) => unknown;

/**
 * Dev-time capture of the exact tool list sent to the provider — position 0 of the
 * request and the most cache-volatile slice of the context window. Mirrors
 * `createSystemPromptCapture`: the snapshot mutates in place and the workbench reads
 * it by reference.
 *
 * A Proxy over the resolved language model intercepts `doStream`/`doGenerate` (v2 and
 * v3 models share the proxy — the spec versions differ only in opaque arg types we
 * forward). Anything that isn't a v2/v3 model instance — a model-id string, a router
 * config — passes through unwrapped.
 *
 * Restored from the kernel-era `final-tool-list-logging.ts` that the purge removed;
 * routed through a snapshot instead of stderr so it feeds the world inspector.
 */
export function createToolListCapture(): ToolListCapture {
  const snapshot: ToolListSnapshot = { tools: [] };
  const wrapped = new WeakMap<object, MastraModelConfig>();

  const wrap = (model: MastraModelConfig): MastraModelConfig => {
    if (typeof model !== "object" || model === null) return model;
    const spec = (model as { specificationVersion?: unknown }).specificationVersion;
    if (spec !== "v2" && spec !== "v3") return model;

    const existing = wrapped.get(model);
    if (existing) return existing;

    const proxy = new Proxy(model as object, {
      get(target, property) {
        if (property === "doStream" || property === "doGenerate") {
          const method = property;
          const call = (target as unknown as Record<typeof method, ModelCall>)[method];
          return (args: ToolCallArgs) => {
            snapshot.tools = summarizeTools(args.tools);
            snapshot.updatedAt = new Date().toISOString();
            return call.call(target, args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as MastraModelConfig;

    wrapped.set(model, proxy);
    return proxy;
  };

  return { snapshot, wrap };
}

function summarizeTools(tools: unknown): ToolListSummaryEntry[] {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    const record = isRecord(tool) ? tool : {};
    return {
      name: typeof record.name === "string" ? record.name : undefined,
      type: typeof record.type === "string" ? record.type : undefined,
      id: typeof record.id === "string" ? record.id : undefined,
      description: typeof record.description === "string" ? record.description : undefined,
      // char/4 estimate of the serialized tool def (name + description + schema).
      approxTokens: approxToolTokens(tool),
    };
  });
}

function approxToolTokens(tool: unknown): number | undefined {
  try {
    return Math.ceil(JSON.stringify(tool).length / 4);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
