import type { LanguageModel } from "@mastra/core/llm";

type ToolCallArgs = {
  tools?: unknown;
  toolChoice?: unknown;
};

type ModelCall = (args: ToolCallArgs) => unknown;

type FinalToolListLogEntry = {
  event: "pe.runtime.final_model_tool_list";
  method: "doStream" | "doGenerate";
  provider?: string;
  modelId?: string;
  specificationVersion?: string;
  toolCount: number;
  tools: Array<{ name?: string; type?: string; id?: string }>;
  toolChoice?: unknown;
};

const wrappedModels = new WeakMap<object, LanguageModel>();

/**
 * Wrap a language model so the exact tool list handed to the provider on each
 * `doStream`/`doGenerate` call is logged to stderr. v2 and v3 models share the
 * same proxy — the spec versions differ only in arg types we forward opaquely.
 */
export function wrapModelForFinalToolListLogging(model: LanguageModel): LanguageModel {
  if (typeof model !== "object" || model === null) return model;
  if (model.specificationVersion !== "v2" && model.specificationVersion !== "v3") return model;

  const existing = wrappedModels.get(model);
  if (existing) return existing;

  const wrapped = new Proxy(model, {
    get(target, property) {
      if (property === "doStream" || property === "doGenerate") {
        const method = property;
        const call = (target as unknown as Record<typeof method, ModelCall>)[method];
        return (args: ToolCallArgs) => {
          logFinalToolList(target, method, args);
          return call.call(target, args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  wrappedModels.set(model, wrapped);
  return wrapped;
}

function logFinalToolList(
  model: LanguageModel,
  method: FinalToolListLogEntry["method"],
  args: ToolCallArgs,
): void {
  const tools = summarizeTools(args.tools);
  const entry: FinalToolListLogEntry = {
    event: "pe.runtime.final_model_tool_list",
    method,
    provider: model.provider,
    modelId: model.modelId,
    specificationVersion: model.specificationVersion,
    toolCount: tools.length,
    tools,
    toolChoice: args.toolChoice,
  };
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

function summarizeTools(tools: unknown): FinalToolListLogEntry["tools"] {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    const record = isRecord(tool) ? tool : {};
    return {
      name: typeof record.name === "string" ? record.name : undefined,
      type: typeof record.type === "string" ? record.type : undefined,
      id: typeof record.id === "string" ? record.id : undefined,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
