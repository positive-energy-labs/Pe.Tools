import { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import type { AnyWorkspace } from "@mastra/core/workspace";
import { peaProductTools } from "../../pe-tools/packages/tools/src/pea/index.js";
import {
  defaultPeaAgentModelId,
  peaAgentInstructions,
} from "./pea-instructions.js";
import { createOpenAIResponsesHistoryCompatProcessor } from "./pea-processors.js";
import {
  peaRuntimePolicy,
  type PeaRuntimePolicy,
} from "../../pe-tools/packages/runtime/src/pea/policy.ts";
import { appendPeaRuntimeContextPrompt } from "../../pe-tools/packages/runtime/src/pea/context.ts";

export type PeaModelResolver = (
  modelId: string,
  options?: {
    thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
    remapForCodexOAuth?: boolean;
    requestContext?: RequestContext;
  },
) => any;

export function createPeaAgent(
  policy: PeaRuntimePolicy = peaRuntimePolicy,
  resolveModel?: PeaModelResolver,
): Agent {
  const processors = policy.openAiResponsesHistoryCompatEnabled
    ? [createOpenAIResponsesHistoryCompatProcessor()]
    : [];

  return new Agent({
    id: "pea-agent",
    name: "Pea Revit Agent",
    description: "High-trust Revit/operator agent for Positive Energy tooling.",
    instructions: ({ requestContext }) =>
      appendPeaRuntimeContextPrompt(peaAgentInstructions, requestContext),
    model: createPeaModelArgument(resolveModel),
    tools: peaProductTools,
    workspace: ({ requestContext }) => {
      const harness = requestContext.get("harness") as
        | PeaHarnessContext
        | undefined;
      return harness?.workspace;
    },
    inputProcessors: processors,
    errorProcessors: processors,
    maxProcessorRetries: 1,
  });
}

export function createPeaModelArgument(resolveModel?: PeaModelResolver) {
  return ({ requestContext }: { requestContext: RequestContext }) => {
    const harness = requestContext.get("harness") as
      | PeaHarnessContext
      | undefined;
    const state = harness?.getState?.();
    const modelId = state?.currentModelId || defaultPeaAgentModelId;
    return resolveModel
      ? resolveModel(modelId, {
          thinkingLevel: state?.thinkingLevel,
          remapForCodexOAuth: true,
          requestContext,
        })
      : modelId;
  };
}

interface PeaHarnessContext {
  workspace?: AnyWorkspace;
  getState?: () => {
    currentModelId?: string;
    thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
  };
}
