import type { LanguageModel } from "@mastra/core/llm";

type ToolCallArgs = {
  tools?: unknown;
  toolChoice?: unknown;
};

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

type FinalToolListLogSink = (entry: FinalToolListLogEntry) => void;

const wrappedModels = new WeakMap<object, LanguageModel>();

export function wrapModelForFinalToolListLogging(
  model: LanguageModel,
  log: FinalToolListLogSink = writeFinalToolListLogToStderr,
): LanguageModel {
  if (typeof model !== "object" || model === null) return model;

  const existing = wrappedModels.get(model);
  if (existing) return existing;

  const wrapped = new Proxy(model, {
    get(target, property) {
      if (property === "doStream") {
        return (args: ToolCallArgs) => {
          logFinalToolList(target, "doStream", args, log);
          return target.doStream(args as never);
        };
      }
      if (property === "doGenerate") {
        return (args: ToolCallArgs) => {
          logFinalToolList(target, "doGenerate", args, log);
          return target.doGenerate(args as never);
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
  log: FinalToolListLogSink,
): void {
  const tools = summarizeTools(args.tools);
  log({
    event: "pe.runtime.final_model_tool_list",
    method,
    provider: model.provider,
    modelId: model.modelId,
    specificationVersion: model.specificationVersion,
    toolCount: tools.length,
    tools,
    toolChoice: args.toolChoice,
  });
}

function summarizeTools(tools: unknown): FinalToolListLogEntry["tools"] {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    const record =
      typeof tool === "object" && tool !== null ? (tool as Record<string, unknown>) : {};
    return {
      name: typeof record.name === "string" ? record.name : undefined,
      type: typeof record.type === "string" ? record.type : undefined,
      id: typeof record.id === "string" ? record.id : undefined,
    };
  });
}

function writeFinalToolListLogToStderr(entry: FinalToolListLogEntry): void {
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}
