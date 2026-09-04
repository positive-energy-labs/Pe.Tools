import { token } from "#/lib/token";
import { annotation } from "#/components/anatomy";
import { useState } from "react";
import { toolTitle } from "@pe/agent-contracts";
import { type ThreadMessageLike } from "@assistant-ui/react";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import type { WorldEvent } from "#/host/use-target";
import {
  imageSource,
  selectToolCalls,
  stringify,
  type ChatState,
  type ToolCall,
} from "../chat-state";
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";
import type { Moment, TraceCell } from "./scale";

export function ContextStrip({ state, depth }: { state: ChatState; depth: "read" | "trace" }) {
  const [open, setOpen] = useState(false);
  const plan = state.display.tasks ?? [];
  const systemPrompt = state.inspect.systemPrompt;
  const showContext = depth !== "read";

  if (plan.length === 0 && !(showContext && systemPrompt?.content)) return null;

  return (
    <div className="mt-[14px] mr-6 ml-[34px] grid gap-2">
      {plan.length > 0 ? (
        <ArtifactFrame head={<span>Plan</span>}>
          {plan.map((entry) => (
            <div className={PLAN_ITEM} data-status={entry.status} key={entry.id}>
              <span
                className={entry.status === "in_progress" ? "text-ink" : "text-ink-2"}
                data-tone={entry.status === "completed" ? "done" : undefined}
              >
                {entry.status === "completed" ? "✓" : entry.status === "in_progress" ? "▸" : "○"}
              </span>
              <span>{entry.content}</span>
            </div>
          ))}
        </ArtifactFrame>
      ) : null}

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
          {open ? (
            <pre className="m-0 px-[9px] py-2 break-words whitespace-pre-wrap">
              {systemPrompt.content}
            </pre>
          ) : null}
        </ArtifactFrame>
      ) : null}
    </div>
  );
}

export const PLAN_ITEM =
  "grid grid-cols-[14px_minmax(0,1fr)] gap-1.5 border-b-[0.5px] border-line px-3 py-1.5 t-prose last:border-b-0";

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

export function CellHeader({ call }: { call: ToolCall }) {
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
  const images = toolImages(output);
  return (
    <>
      <CellHeader call={call} />
      {input !== undefined ? (
        <>
          <div {...annotation("io-label")}>in</div>
          <pre>{stringify(input, 2)}</pre>
        </>
      ) : null}
      {images.length > 0 ? (
        images.map((src, index) => (
          <img key={index} {...annotation("tool-image")} src={src} alt="" />
        ))
      ) : output !== undefined ? (
        <>
          <div {...annotation("io-label")}>out</div>
          <pre>{stringify(output, 2)}</pre>
        </>
      ) : null}
      {error ? <pre {...annotation("io-error")}>{error}</pre> : null}
    </>
  );
}

export function toolImages(output: unknown): string[] {
  const parts = Array.isArray(output) ? output : [output];
  return parts.flatMap((part) => {
    if (typeof part === "string") return part.startsWith("data:image/") ? [part] : [];
    if (part === null || typeof part !== "object") return [];
    const record = part as Record<string, unknown>;
    const mime = (record.mediaType ?? record.mimeType) as string | undefined;
    if (mime && !mime.startsWith("image/")) return [];
    const direct = (record.image ?? record.url) as string | undefined;
    const data = typeof record.data === "string" ? record.data : undefined;
    const url = imageSource(direct, data, mime);
    return url && (mime?.startsWith("image/") || url.startsWith("data:image/")) ? [url] : [];
  });
}

export function toMoments(messages: ThreadMessageLike[]): Moment[] {
  let turn = 0;
  return messages.map((message, index) => {
    if (message.role === "user") turn += 1;
    return {
      id: message.id ?? `m:${index}`,
      turn: Math.max(1, turn),
      role: message.role,
      createdAt: message.createdAt,
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

export function ticksForMoment(log: WorldEvent[], moments: Moment[], index: number): WorldEvent[] {
  if (log.length === 0) return [];
  const at = (i: number) => moments[i]?.createdAt?.getTime();
  const lower = index > 0 ? at(index - 1) : undefined;
  const upper = at(index);
  const isLast = index === moments.length - 1;
  return log
    .filter((event) => {
      if (lower !== undefined && event.atMs <= lower) return false;
      if (upper !== undefined && event.atMs > upper) return isLast; // tail events ride the last band
      return upper !== undefined || isLast;
    })
    .slice(0, 4); // a band is ~turn-height; more than 4 ticks would smear
}

export function formatTime(date?: Date): string | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const TOOL_STATUS_COLOR: Record<string, string> = {
  completed: token("done"),
  failed: token("caution"),
  in_progress: token("ink-2"),
};

export function statusColor(status: string): string {
  return TOOL_STATUS_COLOR[status] ?? token("ink-2");
}

export const TARGET_RAIL_COLOR: Record<string, string> = {
  pinned: token("done"),
  implicit: token("done"),
  ambiguous: token("caution"),
  dangling: token("alarm"),
  muted: token("ink-mute"),
};
