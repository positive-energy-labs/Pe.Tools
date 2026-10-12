import { token } from "#/lib/token";
import { annotation } from "#/components/anatomy";
import { toolTitle } from "@pe/agent-contracts";
import { Code, stringify } from "#/components/lang/code";
import { selectToolCalls, type ChatMessage, type ChatState, type ToolCall } from "../chat-state";
import type { Moment, TraceCell } from "./scale";

export function TraceCellView({
  cell,
  registerRef,
}: {
  cell: TraceCell;
  registerRef: (el: HTMLElement | null) => void;
}) {
  return (
    <div data-key={cell.key} {...annotation("trace-cell")} ref={registerRef}>
      <CellHeader call={cell.call} />
    </div>
  );
}

function CellHeader({ call }: { call: ToolCall }) {
  return (
    <div {...annotation("cell-head")}>
      <span {...annotation("cell-title")}>{toolTitle(call.title)}</span>
      <span {...annotation("cell-meta")}>
        <span className="" style={{ color: statusColor(call.status) }}>
          {call.status.replace("_", " ")}
        </span>
      </span>
    </div>
  );
}

export function ToolCellBody({ call }: { call: ToolCall }) {
  const input = call.args;
  const output = call.status === "completed" ? call.result : undefined;
  const error = call.status === "failed" ? call.error : undefined;
  const images = call.status === "completed" ? call.images : [];
  return (
    <>
      <CellHeader call={call} />
      {input !== undefined ? <Code code={stringify(input)} lang="json" title="in" /> : null}
      {images.length > 0 ? (
        images.map((src, index) => (
          <img key={index} {...annotation("tool-image")} src={src} alt="" />
        ))
      ) : output !== undefined ? (
        <Code code={stringify(output)} lang="json" title="out" />
      ) : null}
      {error ? <Code code={error} lang="plaintext" title="error" tone="error" wrap /> : null}
    </>
  );
}

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

export function buildTraceCells(state: ChatState): TraceCell[] {
  return selectToolCalls(state).map((call) => ({
    key: `tool:${call.id}`,
    call,
    parentId: call.parentMessageId,
  }));
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

const TOOL_STATUS_COLOR: Record<string, string> = {
  completed: token("done"),
  failed: token("caution"),
  in_progress: token("ink-2"),
  expired: token("ink-2"),
  cancelled: token("ink-2"),
};

function statusColor(status: string): string {
  return TOOL_STATUS_COLOR[status] ?? token("ink-2");
}
