import type {
  AgentController,
  AgentControllerDisplayState,
  AvailableModel,
  PermissionRules,
  Session,
  WireDisplayState,
} from "@mastra/core/agent-controller";
import { Buffer } from "node:buffer";
import {
  threadAccess,
  type DeferredToolResultRef,
  type ThreadViewState,
  type ToolResultResponse,
  type ToolResultSummary,
} from "@pe/agent-contracts";

export const DEFERRED_TOOL_RESULT_BYTES = 64 * 1024;

type RuntimeThreadViewState = ThreadViewState<
  Awaited<ReturnType<AgentController["queryThreadMessages"]>>[number],
  AvailableModel,
  PermissionRules
>;

export function toWireDisplayState(displayState: AgentControllerDisplayState): WireDisplayState {
  const state = structuredClone(displayState);
  return {
    ...state,
    activeTools: Object.fromEntries(state.activeTools),
    toolInputBuffers: Object.fromEntries(state.toolInputBuffers),
    pendingSuspensions: Object.fromEntries(state.pendingSuspensions),
    activeSubagents: Object.fromEntries(state.activeSubagents),
    modifiedFiles: Object.fromEntries(state.modifiedFiles),
  };
}

export async function readThreadState(
  runtime: {
    controller: Pick<AgentController, "init" | "queryThreadMessages" | "listAvailableModels">;
    metadata?: Record<string, unknown>;
  },
  session: Session,
  threadId: string,
): Promise<RuntimeThreadViewState> {
  await runtime.controller.init();
  const [storedMessages, available] = await Promise.all([
    runtime.controller.queryThreadMessages({ threadId }),
    runtime.controller.listAvailableModels(),
  ]);
  const { messages, deferredResults } = projectThreadMessages(storedMessages);
  const permissions = session.permissions.getRules();
  return {
    messages,
    ...(deferredResults.length ? { deferredResults } : {}),
    models: { currentId: session.model.get() || undefined, available },
    permissions,
    access: threadAccess(permissions),
    modeId: session.mode.get(),
    inspect: runtime.metadata?.workbench ?? {},
  };
}

type ThreadMessage = Awaited<ReturnType<AgentController["queryThreadMessages"]>>[number];

export function projectThreadMessages(messages: ThreadMessage[]): {
  messages: ThreadMessage[];
  deferredResults: DeferredToolResultRef[];
} {
  const deferredResults: DeferredToolResultRef[] = [];
  const projected = messages.map((message) => {
    let changed = false;
    const parts = message.content.parts.map((part) => {
      if (part.type !== "tool-invocation") return part;
      const invocation = part.toolInvocation;
      if (invocation.state !== "result" || invocation.isError === true) return part;
      const result = invocation.result;
      if (isValidationFailure(result)) return part;
      const json = JSON.stringify(result);
      if (json === undefined) return part;
      const byteSize = Buffer.byteLength(json, "utf8");
      if (byteSize <= DEFERRED_TOOL_RESULT_BYTES) return part;
      deferredResults.push({
        messageId: message.id,
        toolCallId: invocation.toolCallId,
        byteSize,
        summary: summarizeResult(result),
      });
      const projectedInvocation = { ...invocation };
      delete projectedInvocation.result;
      changed = true;
      return { ...part, toolInvocation: projectedInvocation };
    });
    return changed ? { ...message, content: { ...message.content, parts } } : message;
  });
  return { messages: projected, deferredResults };
}

export async function readToolResult(
  runtime: { controller: Pick<AgentController, "init" | "queryThreadMessages"> },
  threadId: string,
  messageId: string,
  toolCallId: string,
): Promise<
  { status: 200; body: ToolResultResponse } | { status: 404 | 409; body: { error: string } }
> {
  await runtime.controller.init();
  const messages = await runtime.controller.queryThreadMessages({ threadId });
  const matches = messages
    .filter((message) => message.id === messageId)
    .flatMap((message) =>
      message.content.parts.filter(
        (part) => part.type === "tool-invocation" && part.toolInvocation.toolCallId === toolCallId,
      ),
    );
  if (matches.length === 0) return { status: 404, body: { error: "tool result not found" } };
  if (matches.length > 1)
    return { status: 409, body: { error: "tool call identity is ambiguous" } };
  const match = matches[0];
  if (match.type !== "tool-invocation")
    return { status: 404, body: { error: "tool result not found" } };
  const invocation = match.toolInvocation;
  if (!("result" in invocation)) return { status: 404, body: { error: "tool result not found" } };
  return { status: 200, body: { messageId, toolCallId, result: invocation.result } };
}

function summarizeResult(result: unknown): ToolResultSummary {
  if (Array.isArray(result)) return { kind: "array", items: result.length };
  if (result !== null && typeof result === "object") {
    const keys = Object.keys(result);
    return { kind: "object", keyCount: keys.length, keys: keys.slice(0, 8) };
  }
  if (typeof result === "string") return { kind: "string", characters: result.length };
  return { kind: "scalar" };
}

function isValidationFailure(result: unknown): boolean {
  return (
    result !== null &&
    typeof result === "object" &&
    "error" in result &&
    (result as { error?: unknown }).error === true
  );
}
