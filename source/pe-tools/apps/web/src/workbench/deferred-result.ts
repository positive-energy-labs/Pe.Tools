import type {
  DeferredToolResultRef,
  ToolResultResponse,
  ToolResultSummary,
} from "@pe/agent-contracts";
import { useHostCall } from "#/readings";
import type { ToolCall } from "./chat-state";
import { useWorkbench } from "./provider";

export function useDeferredToolResult(call: ToolCall, enabled: boolean) {
  const workbench = useWorkbench();
  const origin = workbench.config?.origin ?? "";
  const threadId = workbench.currentThreadId ?? "";
  const ref = workbench.chat?.deferredResults?.find(
    (item) => item.messageId === call.parentMessageId && item.toolCallId === call.id,
  );
  const query = useHostCall(
    (signal) => loadDeferredToolResult(origin, threadId, ref!, signal),
    [origin, threadId, ref?.messageId, ref?.toolCallId],
    enabled && ref !== undefined,
  );
  return {
    ref,
    result: ref ? (enabled ? query.data?.result : undefined) : call.result,
    pending: ref !== undefined && enabled && query.pending,
    error: ref !== undefined && enabled ? query.error : undefined,
    retry: query.refresh,
  };
}

export async function loadDeferredToolResult(
  origin: string,
  threadId: string,
  ref: DeferredToolResultRef,
  signal: AbortSignal,
): Promise<ToolResultResponse> {
  const path = [threadId, "tool-result", ref.messageId, ref.toolCallId]
    .map(encodeURIComponent)
    .join("/");
  const response = await fetch(`${origin}/pe/thread/${path}`, { signal });
  if (!response.ok) throw new Error(`Tool result failed to load (${response.status}).`);
  const result = (await response.json()) as ToolResultResponse;
  if (result.messageId !== ref.messageId || result.toolCallId !== ref.toolCallId)
    throw new Error("Tool result identity did not match the requested call.");
  return result;
}

export function deferredResultSummary(summary: ToolResultSummary): string {
  if (summary.kind === "array") return `${summary.items} items`;
  if (summary.kind === "object")
    return summary.keys.length ? summary.keys.join(", ") : `${summary.keyCount} keys`;
  if (summary.kind === "string") return `${summary.characters} characters`;
  return "result";
}
