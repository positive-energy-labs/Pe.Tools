import { token } from "#/lib/token";
import { annotation } from "#/components/anatomy";
import { useState } from "react";
import { toolTitle } from "@pe/agent-contracts";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Code, stringify } from "#/components/lang/code";
import {
  selectToolCalls,
  formatBytes,
  toolImages,
  type ChatMessage,
  type ChatState,
  type ToolCall,
} from "../chat-state";
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";
import type { Moment, TraceCell } from "./scale";
import { deferredResultSummary, useDeferredToolResult } from "../deferred-result";

export function ContextStrip({ state, depth }: { state: ChatState; depth: "read" | "trace" }) {
  const [open, setOpen] = useState(false);
  const systemPrompt = state.inspect.systemPrompt;
  const showContext = depth !== "read";

  if (!(showContext && systemPrompt?.content)) return null;

  return (
    <div className="mt-[14px] mr-6 ml-[34px] grid gap-2">
      {showContext && systemPrompt?.content ? (
        <ArtifactFrame
          head={
            <span className="w-full [&>button]:w-full">
              <Press
                type="button"
                tone="quiet"
                size="caption"
                title="Show or hide the resolved system prompt pea started with"
                onClick={() => setOpen((value) => !value)}
              >
                <PressContent geometry="block">
                  <span className="flex items-baseline justify-between gap-3 t-upper">
                    <span>
                      System prompt{systemPrompt.source ? ` · ${systemPrompt.source}` : ""}
                    </span>
                    <span>{open ? "hide" : "show"}</span>
                  </span>
                </PressContent>
              </Press>
            </span>
          }
        >
          {open ? <Code code={systemPrompt.content} lang="plaintext" wrap /> : null}
        </ArtifactFrame>
      ) : null}
    </div>
  );
}

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
  const deferred = useDeferredToolResult(call, true);
  const input = call.args;
  const output = call.status === "completed" ? deferred.result : undefined;
  const error = call.status === "failed" ? call.error : undefined;
  const images =
    call.status === "completed" ? (deferred.ref ? toolImages(output) : call.images) : [];
  return (
    <>
      <CellHeader call={call} />
      {deferred.ref ? (
        <span className="t-small text-ink-2">
          {deferredResultSummary(deferred.ref.summary)} · {formatBytes(deferred.ref.byteSize)}
        </span>
      ) : null}
      {input !== undefined ? <Code code={stringify(input)} lang="json" title="in" /> : null}
      {deferred.pending ? (
        <div className="t-prose text-ink-2">Loading full result…</div>
      ) : deferred.error ? (
        <div className="flex items-baseline gap-2 t-prose" data-tone="caution">
          <span>{deferred.error.message}</span>
          <Press type="button" tone="quiet" size="caption" onClick={deferred.retry}>
            retry
          </Press>
        </div>
      ) : images.length > 0 ? (
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
