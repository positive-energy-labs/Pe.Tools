import type { ChatMessage, ChatPart } from "./chat-state";

export type CallPart = Extract<ChatPart, { type: "tool-call" }>;
export type ThoughtPart = Extract<ChatPart, { type: "reasoning" }>;
/** Machinery: a tool call or the thought between calls. One uninterrupted run of these folds as one. */
export type RunPart = CallPart | ThoughtPart;
export type Segment =
  | { key: string; run: RunPart[] }
  | { index: number; part: Exclude<ChatPart, RunPart> };

/** Message boundaries do not interrupt a run. Agent prose, attachments and other speakers do. */
export function transcriptSegments(messages: ChatMessage[]): Map<string, Segment[]> {
  const groups = new Map<string, Segment[]>();
  let run: RunPart[] | undefined;
  for (const message of messages) {
    const parts: Segment[] = [];
    groups.set(message.id, parts);
    if (message.role !== "assistant") {
      run = undefined;
      continue;
    }
    message.parts.forEach((part, index) => {
      if (part.type !== "tool-call" && part.type !== "reasoning") {
        run = undefined;
        parts.push({ index, part });
      } else if (run) run.push(part);
      else {
        run = [part];
        parts.push({
          key: part.type === "tool-call" ? part.call.id : `${message.id}:${index}`,
          run,
        });
      }
    });
  }
  return groups;
}
