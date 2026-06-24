import type { ThreadMessageLike } from "@assistant-ui/react";
import type {
  WorkbenchApprovalRequest,
  WorkbenchMessage,
  WorkbenchState,
  WorkbenchToolCall,
} from "@pe/agent-contracts";

type LikeContent = Exclude<ThreadMessageLike["content"], string>;
type LikePart = LikeContent[number];

/**
 * The render-from-WorkbenchState projection: `WorkbenchState -> ThreadMessageLike[]`.
 *
 * This is the single contract that lets assistant-ui render our chat WITHOUT owning
 * any state — WorkbenchState stays the one source of truth (the rule that keeps us
 * out of the dual-store mess Phases 1-4 removed). assistant-ui's ExternalStoreRuntime
 * holds no copy; it renders whatever this returns.
 *
 * Tools live in `state.tools.calls` (not on message parts in the live path), so we fold
 * each tool into its parent assistant message as a `tool-call` part — assistant-ui's
 * native shape. A pending approval for that tool rides along as the part's `approval`
 * gate (rendered + resolved by the ToolCall part component).
 */
export function workbenchToThreadMessages(state: WorkbenchState): ThreadMessageLike[] {
  const chat = state.transcript.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const lastAssistantId = [...chat].reverse().find((m) => m.role === "assistant")?.id;

  // Group tools under their parent assistant message; orphans fall to the last assistant
  // turn (never a trailing user message — that would hoist a prior run's tools below it).
  const assistantIds = new Set(chat.filter((m) => m.role === "assistant").map((m) => m.id));
  const toolsByParent = new Map<string, WorkbenchToolCall[]>();
  for (const call of state.tools.calls) {
    const ref = call.parentMessageId ?? call.provenance?.messageId;
    const parent = ref && assistantIds.has(ref) ? ref : lastAssistantId;
    if (!parent) continue; // ponytail: tool before any assistant turn — drop (never happens live)
    const list = toolsByParent.get(parent);
    if (list) list.push(call);
    else toolsByParent.set(parent, [call]);
  }

  return chat.map((message): ThreadMessageLike => {
    if (message.role === "user") {
      return { role: "user", id: message.id, content: textContent(message), ...createdAt(message) };
    }
    const content: LikePart[] = [...textContent(message)];
    for (const call of toolsByParent.get(message.id) ?? []) {
      content.push(toolCallPart(call, findApproval(state.approvals.requests, call.id)));
    }
    return {
      role: "assistant",
      id: message.id,
      content,
      status:
        message.status === "streaming"
          ? { type: "running" }
          : message.status === "error"
            ? { type: "incomplete", reason: "error" }
            : { type: "complete", reason: "unknown" },
      ...createdAt(message),
    };
  });
}

function textContent(message: WorkbenchMessage): LikePart[] {
  const parts = message.parts.flatMap((part): LikePart[] => {
    if (part.kind === "text") return [{ type: "text", text: part.text }];
    if (part.kind === "reasoning" || part.kind === "thought")
      return [{ type: "reasoning", text: part.text }];
    return [];
  });
  // A user turn with no text part still needs a content entry to render.
  if (parts.length === 0 && message.role === "user") return [{ type: "text", text: "" }];
  return parts;
}

function toolCallPart(
  call: WorkbenchToolCall,
  approval: WorkbenchApprovalRequest | undefined,
): LikePart {
  const result = call.rawOutput ?? call.content;
  const argsObject = isRecord(call.rawInput)
    ? (call.rawInput as Record<string, unknown>)
    : undefined;
  // Built as a plain record then cast once at this boundary — the tool-call part's
  // `args`/`result` are JSON-typed and our WorkbenchToolCall fields are `unknown`.
  const part: Record<string, unknown> = {
    type: "tool-call",
    toolCallId: call.id,
    toolName: call.title,
    ...(argsObject ? { args: argsObject } : { argsText: stringifyArgs(call.rawInput) }),
    ...(result !== undefined ? { result } : {}),
    ...(call.status === "failed" ? { isError: true } : {}),
    ...(approval
      ? {
          approval: {
            id: approval.requestId,
            approved: undefined,
            options: approval.options.map((option) => ({
              id: option.optionId,
              kind: approvalKind(option.kind),
              label: option.name,
            })),
          },
        }
      : {}),
  };
  return part as LikePart;
}

function findApproval(
  requests: WorkbenchApprovalRequest[],
  toolCallId: string,
): WorkbenchApprovalRequest | undefined {
  return requests.find(
    (request) => request.status === "pending" && request.toolCall.id === toolCallId,
  );
}

/** ACP option kinds use underscores; assistant-ui's ToolApprovalOptionKind uses hyphens. */
function approvalKind(kind: string): string {
  return kind.replaceAll("_", "-");
}

function stringifyArgs(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function createdAt(message: WorkbenchMessage): { createdAt?: Date } {
  const iso = message.createdAt ?? message.updatedAt;
  if (!iso) return {};
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? {} : { createdAt: date };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
