import type { LanguageModel } from "@mastra/core/llm";

type ToolCallArgs = {
  tools?: unknown;
  toolChoice?: unknown;
};

type LanguageModelV2 = Extract<LanguageModel, { specificationVersion: "v2" }>;
type LanguageModelV3 = Extract<LanguageModel, { specificationVersion: "v3" }>;
type DoStreamV2Args = Parameters<LanguageModelV2["doStream"]>[0];
type DoGenerateV2Args = Parameters<LanguageModelV2["doGenerate"]>[0];
type DoStreamV3Args = Parameters<LanguageModelV3["doStream"]>[0];
type DoGenerateV3Args = Parameters<LanguageModelV3["doGenerate"]>[0];

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

const wrappedV2Models = new WeakMap<object, LanguageModelV2>();
const wrappedV3Models = new WeakMap<object, LanguageModelV3>();

export function wrapModelForFinalToolListLogging(
  model: LanguageModel,
  log: FinalToolListLogSink = writeFinalToolListLogToStderr,
): LanguageModel {
  if (typeof model !== "object" || model === null) return model;
  if (model.specificationVersion === "v2") return wrapV2ModelForFinalToolListLogging(model, log);
  if (model.specificationVersion === "v3") return wrapV3ModelForFinalToolListLogging(model, log);
  return model;
}

function wrapV2ModelForFinalToolListLogging(
  model: LanguageModelV2,
  log: FinalToolListLogSink,
): LanguageModelV2 {
  const existing = wrappedV2Models.get(model);
  if (existing) return existing;

  const wrapped = new Proxy(model, {
    get(target, property) {
      if (property === "doStream") {
        return (args: DoStreamV2Args) => {
          logFinalToolList(target, "doStream", args, log);
          return target.doStream(args);
        };
      }
      if (property === "doGenerate") {
        return (args: DoGenerateV2Args) => {
          logFinalToolList(target, "doGenerate", args, log);
          return target.doGenerate(args);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  wrappedV2Models.set(model, wrapped);
  return wrapped;
}

function wrapV3ModelForFinalToolListLogging(
  model: LanguageModelV3,
  log: FinalToolListLogSink,
): LanguageModelV3 {
  const existing = wrappedV3Models.get(model);
  if (existing) return existing;

  const wrapped = new Proxy(model, {
    get(target, property) {
      if (property === "doStream") {
        return (args: DoStreamV3Args) => {
          logFinalToolList(target, "doStream", args, log);
          return target.doStream(args);
        };
      }
      if (property === "doGenerate") {
        return (args: DoGenerateV3Args) => {
          logFinalToolList(target, "doGenerate", args, log);
          return target.doGenerate(args);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  wrappedV3Models.set(model, wrapped);
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

function writeFinalToolListLogToStderr(entry: FinalToolListLogEntry): void {
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}
