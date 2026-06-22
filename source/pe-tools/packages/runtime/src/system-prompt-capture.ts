import type { InputProcessor } from "@mastra/core/processors";
import type { WorkbenchSystemPromptSnapshot } from "@pe/agent-contracts";

export type { WorkbenchSystemPromptSnapshot } from "@pe/agent-contracts";

export interface SystemPromptCapture {
  /**
   * Mutable snapshot the processor writes into. Point
   * `handle.metadata.workbench.systemPrompt` at this same object so the AG-UI
   * workbench metadata emits the resolved prompt by reference.
   */
  snapshot: WorkbenchSystemPromptSnapshot;
  /**
   * Read-only input processor. Add it to the agent's `inputProcessors`; it runs
   * last (after memory/workspace/skills processors), so its `processLLMRequest`
   * sees the fully resolved prompt at the provider boundary.
   */
  processor: InputProcessor;
}

/**
 * Dev-time capture of the system prompt actually sent over the wire.
 *
 * mastra resolves input processors as `[memory, workspace, skills, ...configured]`,
 * so an agent-configured processor's `processLLMRequest` receives the prompt after
 * skills/workspace/memory injection — i.e. the real bytes. Capture is read-only:
 * the processor returns nothing, forwarding the prompt unchanged.
 */
export function createSystemPromptCapture(
  initial: WorkbenchSystemPromptSnapshot,
): SystemPromptCapture {
  const snapshot: WorkbenchSystemPromptSnapshot = { ...initial };
  const processor: InputProcessor = {
    id: "pe-system-prompt-capture",
    processLLMRequest({ prompt }) {
      snapshot.content = prompt
        .filter((message) => message.role === "system")
        .map((message) =>
          typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        )
        .join("\n---\n");
      snapshot.source = "resolved (provider boundary)";
      snapshot.updatedAt = new Date().toISOString();
      // ponytail: read-only — no return so mastra forwards the prompt unchanged.
    },
  };
  return { snapshot, processor };
}
