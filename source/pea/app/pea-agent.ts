import { Agent } from "@mastra/core/agent";
import type { AnyWorkspace } from "@mastra/core/workspace";
import { peaTools } from "./tools.js";
import {
  defaultPeaAgentModelId,
  peaAgentInstructions,
} from "./pea-instructions.js";
import type { PeaContextProvider } from "./pea-context-seed.js";
import { createOpenAIResponsesHistoryCompatProcessor } from "./pea-processors.js";
import { peaRuntimePolicy, type PeaRuntimePolicy } from "./pea-runtime-policy.js";

export function createPeaAgent(
  policy: PeaRuntimePolicy = peaRuntimePolicy,
  contextProvider?: PeaContextProvider,
): Agent {
  const processors = policy.openAiResponsesHistoryCompatEnabled
    ? [createOpenAIResponsesHistoryCompatProcessor()]
    : [];

  return new Agent({
    id: "pea-agent",
    name: "Pea Revit Agent",
    description: "High-trust Revit/operator agent for Positive Energy tooling.",
    instructions: async ({ requestContext }) => {
      if (!contextProvider)
        return peaAgentInstructions;

      const harness = requestContext.get("harness") as
        | PeaHarnessContext
        | undefined;
      try {
        const context = await contextProvider({ threadId: harness?.threadId });
        return `${peaAgentInstructions}\n\n${context}`;
      } catch (error) {
        const detail = escapeXml(error instanceof Error ? error.message : String(error));
        return `${peaAgentInstructions}\n\n<pea-startup-context>\nContext seed unavailable: ${detail}. Use pe_status for fresh host/Revit state.\n</pea-startup-context>`;
      }
    },
    model: ({ requestContext }) => {
      const harness = requestContext.get("harness") as
        | PeaHarnessContext
        | undefined;
      return harness?.getState?.().currentModelId || defaultPeaAgentModelId;
    },
    tools: peaTools,
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

interface PeaHarnessContext {
  threadId?: string;
  workspace?: AnyWorkspace;
  getState?: () => {
    currentModelId?: string;
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
