import type { LanguageModel } from "@mastra/core/llm";
import { expect, test } from "vite-plus/test";
import { wrapModelForFinalToolListLogging } from "../src/harness/final-tool-list-logging.ts";

test("wrapModelForFinalToolListLogging logs final model-call tools and delegates unchanged", async () => {
  const calls: unknown[] = [];
  const logs: unknown[] = [];
  const streamArgs = {
    tools: [
      { type: "function", name: "read_file" },
      { type: "provider-defined", name: "web_search", id: "openai.web_search" },
    ],
    toolChoice: { type: "auto" },
  };
  const generateArgs = {
    tools: undefined,
    toolChoice: { type: "none" },
  };
  const model = {
    provider: "openai",
    modelId: "gpt-test",
    specificationVersion: "v2",
    async doStream(args: unknown) {
      calls.push({ method: "doStream", args, thisValue: this });
      return "stream-result";
    },
    async doGenerate(args: unknown) {
      calls.push({ method: "doGenerate", args, thisValue: this });
      return "generate-result";
    },
  } as unknown as LanguageModel;

  const wrapped = wrapModelForFinalToolListLogging(model, (entry) => logs.push(entry));

  await expect(wrapped.doStream(streamArgs as never)).resolves.toBe("stream-result");
  await expect(wrapped.doGenerate(generateArgs as never)).resolves.toBe("generate-result");

  expect(calls).toEqual([
    { method: "doStream", args: streamArgs, thisValue: model },
    { method: "doGenerate", args: generateArgs, thisValue: model },
  ]);
  expect(logs).toEqual([
    {
      event: "pe.runtime.final_model_tool_list",
      method: "doStream",
      provider: "openai",
      modelId: "gpt-test",
      specificationVersion: "v2",
      toolCount: 2,
      tools: [
        { name: "read_file", type: "function", id: undefined },
        { name: "web_search", type: "provider-defined", id: "openai.web_search" },
      ],
      toolChoice: { type: "auto" },
    },
    {
      event: "pe.runtime.final_model_tool_list",
      method: "doGenerate",
      provider: "openai",
      modelId: "gpt-test",
      specificationVersion: "v2",
      toolCount: 0,
      tools: [],
      toolChoice: { type: "none" },
    },
  ]);
});
