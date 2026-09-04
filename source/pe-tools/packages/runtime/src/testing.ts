import { Agent } from "@mastra/core/agent";
import { type AvailableModel } from "@mastra/core/agent-controller";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { createTool } from "@mastra/core/tools";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { dirname } from "node:path";
import { z } from "zod";
import { turnScopeContextKey, turnScopeSchema } from "@pe/agent-contracts";
import type { ServableRuntime } from "./agent-controller-web.ts";
import { createRuntimeController } from "./controller/create-runtime-controller.ts";
import { createRuntimeMemoryProfile } from "./memory/profiles.ts";
import { messageContents } from "./pea-runtime.ts";
import { createRuntimeLibSqlStorage } from "./storage/profiles.ts";

type DeterministicResponse =
  | { text: string; finishDelayMs?: number }
  | { toolCall: { name: "scenario_approval"; input: { value: string } } }
  | {
      toolCall: {
        name: "ask_user";
        input: {
          question: string;
          options: { label: string; description?: string }[];
          selectionMode?: "single_select" | "multi_select";
        };
      };
    };

function responseStream(response: DeterministicResponse, responseAt: number) {
  return new ReadableStream({
    async start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      controller.enqueue({
        type: "response-metadata",
        id: `response-${responseAt}`,
        modelId: "scenario/mock",
        timestamp: new Date(0),
      });
      if ("toolCall" in response) {
        controller.enqueue({
          type: "tool-call",
          toolCallId: `scenario-call-${responseAt}`,
          toolName: response.toolCall.name,
          input: JSON.stringify(response.toolCall.input),
          providerExecuted: false,
        });
        controller.enqueue({
          type: "finish",
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });
        controller.close();
        return;
      }
      controller.enqueue({ type: "text-start", id: "text-1" });
      controller.enqueue({ type: "text-delta", id: "text-1", delta: response.text });
      if (response.finishDelayMs)
        await new Promise((resolveWait) => setTimeout(resolveWait, response.finishDelayMs));
      try {
        controller.enqueue({ type: "text-end", id: "text-1" });
        controller.enqueue({
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });
        controller.close();
      } catch {
        // The scenario intentionally aborts while this deterministic model is paused.
      }
    },
  });
}

/** Real controller + LibSQL storage with only the model boundary made deterministic. */
export async function createDeterministicRuntime(options: {
  databasePath: string;
  resourceId: string;
  responses: DeterministicResponse[];
  preseed?: {
    threadId: string;
    messages: { id: string; role: "user" | "assistant"; text: string }[];
  };
}): Promise<ServableRuntime> {
  let responseAt = 0;
  const approvalTool = createTool({
    id: "scenario_approval",
    description: "Return a deterministic value after approval.",
    inputSchema: z.object({ value: z.string() }),
    requireApproval: true,
    execute: async ({ value }) => ({ output: `APPROVED:${value}` }),
  });
  const agent = new Agent({
    id: "scenario-agent",
    name: "Scenario Agent",
    instructions: "Answer the user.",
    model: new MastraLanguageModelV2Mock({
      doStream: async () => {
        const at = responseAt++;
        const response = options.responses[Math.min(at, options.responses.length - 1)]!;
        return { stream: responseStream(response, at) };
      },
    }) as never,
    tools: { scenario_approval: approvalTool },
  });
  const storage = await createRuntimeLibSqlStorage({
    id: "browser-scenario",
    url:
      options.databasePath === ":memory:"
        ? "file::memory:?cache=shared"
        : `file:${options.databasePath}`,
  });
  if (options.preseed) {
    await storage.init();
    const memory = await storage.getStore("memory");
    if (!memory) throw new Error("Deterministic runtime requires a memory store.");
    const createdAt = new Date("2026-09-03T00:00:00.000Z");
    await memory.saveThread({
      thread: {
        id: options.preseed.threadId,
        title: "Browser scenario",
        resourceId: options.resourceId,
        createdAt,
        updatedAt: createdAt,
      },
    });
    await memory.saveMessages({
      messages: options.preseed.messages.map((message, index) => ({
        id: message.id,
        role: message.role,
        threadId: options.preseed!.threadId,
        resourceId: options.resourceId,
        createdAt: new Date(createdAt.getTime() + index),
        content: { format: 2, parts: [{ type: "text", text: message.text }] },
      })),
    });
  }
  const runtime = await createRuntimeController({
    request: { protocol: "web" },
    memoryProfile: createRuntimeMemoryProfile({ options: { observationalMemory: false } }),
    configureController: (controller) =>
      controller.onSessionCreated(
        (session) => {
          const sendMessage = session.sendMessage.bind(session);
          session.sendMessage = async (input) => {
            const context = input.requestContext as
              | { get?: (key: string) => unknown }
              | Record<string, unknown>
              | undefined;
            const scope = turnScopeSchema.safeParse(
              typeof context?.get === "function"
                ? context.get(turnScopeContextKey)
                : (context as Record<string, unknown> | undefined)?.[turnScopeContextKey],
            );
            if (!scope.success) return sendMessage(input);
            const signal = session.sendSignal(
              {
                type: "user",
                tagName: "user",
                id: scope.data.id,
                contents: messageContents(input.content, input.files),
                metadata: { scope: scope.data },
              },
              { requestContext: input.requestContext },
            );
            await signal.accepted;
          };
        },
        { blocking: true },
      ),
    config: {
      id: "pea",
      resourceId: options.resourceId,
      storage,
      workspace: new Workspace({
        name: "Browser scenario",
        filesystem: new LocalFilesystem({
          basePath: dirname(options.databasePath),
          contained: true,
        }),
      }),
      agent,
      modes: [{ id: "agent", name: "Agent", defaultModelId: "scenario/mock" }],
      defaultModeId: "agent",
      initialState: {},
    },
    metadata: { workbench: {} },
  });
  runtime.controller.listAvailableModels = async () =>
    [
      {
        id: "scenario/mock",
        provider: "scenario",
        modelName: "mock",
        hasApiKey: true,
        useCount: 0,
      },
      {
        id: "scenario/alternate",
        provider: "scenario",
        modelName: "alternate",
        hasApiKey: true,
        useCount: 0,
      },
    ] satisfies AvailableModel[];
  return {
    controller: runtime.controller,
    resourceId: options.resourceId,
    mastra: runtime.mastra,
    storage,
    metadata: runtime.metadata,
    close: runtime.close,
  };
}
