import type { ThreadMessageLike } from "@assistant-ui/react";
import type { MastraDBMessage } from "@mastra/client-js";
import {
  APPROVAL_OPTIONS,
  imageSource,
  readRecord,
  readString,
  selectApprovals,
  stringify,
  toolTarget,
  type ChatDisplay,
  type ChatState,
} from "./chat-state";

type LikeContent = Exclude<ThreadMessageLike["content"], string>;
type LikePart = LikeContent[number];

/**
 * `ChatState -> ThreadMessageLike[]`: the one contract that lets assistant-ui render our chat
 * WITHOUT owning any state. Its ExternalStoreRuntime holds no copy; it renders whatever this
 * returns.
 *
 * Messages are native `MastraDBMessage`s, so a tool call is read straight off its
 * `tool-invocation` part (which already carries `state`/`args`/`result`/`isError`) and lands where
 * the model emitted it. A tool that is still streaming has no part yet — those come from
 * `display.activeTools` and append to the last assistant turn. A pending approval or suspension
 * for a call rides along as the part's `approval` gate.
 */
export function toThreadMessages(state: ChatState): ThreadMessageLike[] {
  const display = state.display;
  const chat = state.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const lastAssistantId = [...chat].reverse().find((m) => m.role === "assistant")?.id;
  const streamingId = display.isRunning ? display.currentMessage?.id : undefined;
  const emitted = new Set<string>();

  const projected = chat.map((message): ThreadMessageLike => {
    const content: LikePart[] = [];
    for (const part of message.content.parts) {
      if (part.type === "text") content.push({ type: "text", text: part.text });
      else if (part.type === "reasoning") content.push({ type: "reasoning", text: part.reasoning });
      else if (part.type === "file") {
        const url = imageSource(undefined, part.data, part.mimeType);
        if (url && (!part.mimeType || part.mimeType.startsWith("image/")))
          content.push({ type: "image", image: url });
      } else if (part.type === "tool-invocation") {
        const call = part.toolInvocation;
        if (emitted.has(call.toolCallId)) continue;
        emitted.add(call.toolCallId);
        content.push(
          toolCallPart({
            id: call.toolCallId,
            name: call.toolName,
            args: call.rawInput ?? call.args,
            result: call.result,
            isError: call.isError === true || call.state === "output-error",
            display,
          }),
        );
      } else if (part.type === "data-signal" || part.type === "data-user-message") {
        // A route-workspace signal is prose the user should read; other signals are chrome.
        const data = readRecord(part.data);
        const text = signalText(data?.contents);
        if (text && data?.tagName === "route-workspace") content.push({ type: "text", text });
      }
    }
    if (message.role === "user")
      return {
        role: "user",
        // A user turn with no text part still needs a content entry to render.
        content: content.length > 0 ? content : [{ type: "text", text: "" }],
        id: message.id,
        ...createdAt(message),
      };
    if (message.id === lastAssistantId) {
      for (const [id, tool] of Object.entries(display.activeTools ?? {})) {
        if (emitted.has(id)) continue;
        emitted.add(id);
        content.push(
          toolCallPart({
            id,
            name: tool.name,
            args: tool.args,
            result: tool.result ?? tool.shellOutput ?? tool.partialResult,
            isError: tool.status === "error" || tool.isError === true,
            display,
          }),
        );
      }
    }
    return {
      role: "assistant",
      id: message.id,
      content,
      status:
        message.id === streamingId ? { type: "running" } : { type: "complete", reason: "unknown" },
      ...createdAt(message),
    };
  });
  // Return EVERY user/assistant turn — assistant-ui's ExternalStore keys mounted message
  // components to array indices and breaks ("Index N out of bounds") if membership shrinks under
  // it. Blank-row suppression is a render-layer concern (moment components return null); the Lens
  // geometry filters with `isRenderable` for its own bands. Do NOT filter the runtime array here.
  return projected;
}

/** A message worth a row: has visible text, an image, a tool call, or is the live streaming turn. */
export function isRenderable(message: ThreadMessageLike): boolean {
  const parts = Array.isArray(message.content) ? message.content : [];
  const hasText = parts.some((part) => part.type === "text" && part.text.trim().length > 0);
  const hasImage = parts.some((part) => part.type === "image");
  const hasTool = parts.some((part) => part.type === "tool-call");
  const running = message.role === "assistant" && message.status?.type === "running";
  return hasText || hasImage || hasTool || running;
}

function toolCallPart(call: {
  id: string;
  name: string;
  args: unknown;
  result: unknown;
  isError: boolean;
  display: ChatDisplay;
}): LikePart {
  const target = toolTarget(call.args);
  const args = readRecord(call.args) ?? (target ? { path: target } : undefined);
  const gated = selectApprovals(call.display).some(
    (approval) => approval.toolCallId === call.id,
  );
  // Built as a plain record then cast once at this boundary — the tool-call part's
  // `args`/`result` are JSON-typed and ours are `unknown`.
  const part: Record<string, unknown> = {
    type: "tool-call",
    toolCallId: call.id,
    toolName: call.name,
    ...(args ? { args } : { argsText: stringify(call.args) }),
    ...(call.result !== undefined ? { result: call.result } : {}),
    ...(call.isError ? { isError: true } : {}),
    // The approval id IS the toolCallId — the provider reads `display` to tell an approval gate
    // from a suspension, so nothing has to be string-encoded into it.
    ...(gated ? { approval: { id: call.id, approved: undefined, options: APPROVAL_OPTIONS } } : {}),
  };
  return part as LikePart;
}

function signalText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => readString(readRecord(part)?.text) ?? "")
    .filter(Boolean)
    .join("\n");
}

function createdAt(message: MastraDBMessage): { createdAt?: Date } {
  const at = message.createdAt;
  if (!at) return {};
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? {} : { createdAt: date };
}
