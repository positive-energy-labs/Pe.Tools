import { toolTitle } from "@pe/agent-contracts";
import type { ChatMessage } from "../chat-state";
import type { Moment } from "./scale";

export function toMoments(messages: ChatMessage[]): Moment[] {
  let turn = 0;
  return messages.map((message) => {
    if (message.role === "user") turn += 1;
    return {
      id: message.id,
      turn: Math.max(1, turn),
      role: message.role,
      createdAt: message.createdAt,
      preview: previewOf(message),
    };
  });
}

/** The preview's length: enough to recognise a turn, short enough to stay a glance. */
const PREVIEW_CHARS = 140;

function previewOf(message: ChatMessage): string | undefined {
  const text = message.parts.find((part) => part.type === "text")?.text;
  // ponytail: strips markdown marks by character, not a parse; a link reads as [label](url).
  const flat = text
    ?.replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // A turn that only called tools previews as its calls.
  const calls = message.parts.flatMap((part) =>
    part.type === "tool-call" ? [toolTitle(part.call.title)] : [],
  );
  if (!flat) return calls.length ? `⌗ ${calls.join(" · ")}`.slice(0, PREVIEW_CHARS) : undefined;
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS).trimEnd()}…` : flat;
}

export function formatTime(date?: Date): string | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
