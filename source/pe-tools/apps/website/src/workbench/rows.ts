import {
  selectPendingApprovals,
  type WorkbenchApprovalRequest,
  type WorkbenchDebugEvent,
  type WorkbenchMessage,
  type WorkbenchObservationMemoryEntry,
  type WorkbenchState,
  type WorkbenchToolCall,
} from "@pe/agent-contracts";
import type { Depth } from "./depth.ts";

export type RowKind = "user" | "assistant" | "tool" | "memory" | "approval" | "event";

export interface Row {
  key: string;
  kind: RowKind;
  seq?: number;
  message?: WorkbenchMessage;
  toolCall?: WorkbenchToolCall;
  memory?: WorkbenchObservationMemoryEntry;
  approval?: WorkbenchApprovalRequest;
  events: WorkbenchDebugEvent[];
}

interface EventIds {
  messageId?: string;
  toolCallId?: string;
  sequence?: number;
}

export function eventIds(event: WorkbenchDebugEvent): EventIds {
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  return {
    messageId: typeof payload.messageId === "string" ? payload.messageId : undefined,
    toolCallId: typeof payload.toolCallId === "string" ? payload.toolCallId : undefined,
    sequence: typeof payload.sequence === "number" ? payload.sequence : undefined,
  };
}

function minSequence(events: WorkbenchDebugEvent[]): number | undefined {
  let min: number | undefined;
  for (const event of events) {
    const { sequence } = eventIds(event);
    if (sequence !== undefined && (min === undefined || sequence < min)) min = sequence;
  }
  return min;
}

/**
 * Unified, occurrence-ordered timeline derived purely from WorkbenchState.
 *
 * Messages keep transcript array order. Tool rows come from durable `tools.calls`
 * and prefer their `parentMessageId` anchor; run sequences are only a fallback
 * when live events do not carry a parent id yet.
 */
export function buildRows(state: WorkbenchState, depth: Depth): Row[] {
  const eventsByMessage = new Map<string, WorkbenchDebugEvent[]>();
  const eventsByTool = new Map<string, WorkbenchDebugEvent[]>();
  const seqByTool = new Map<string, number>();
  const matched = new Set<WorkbenchDebugEvent>();
  const runStartSeqs: number[] = [];
  for (const event of state.debug.events) {
    const ids = eventIds(event);
    if (event.type === "RUN_STARTED" && ids.sequence !== undefined) runStartSeqs.push(ids.sequence);
    if (ids.toolCallId) {
      pushInto(eventsByTool, ids.toolCallId, event);
      matched.add(event);
      if (ids.sequence !== undefined) {
        seqByTool.set(
          ids.toolCallId,
          Math.min(seqByTool.get(ids.toolCallId) ?? Infinity, ids.sequence),
        );
      }
    } else if (ids.messageId) {
      pushInto(eventsByMessage, ids.messageId, event);
      matched.add(event);
    }
  }
  runStartSeqs.sort((left, right) => left - right);

  const ordered: { row: Row; order: number }[] = [];
  const assistantOrders: number[] = [];
  const orderByMessageId = new Map<string, number>();
  let index = 0;
  for (const message of state.transcript.messages) {
    if (message.role === "tool") continue;
    const events = eventsByMessage.get(message.id) ?? [];
    const order = index++;
    orderByMessageId.set(message.id, order);
    ordered.push({
      order,
      row: {
        key: `msg:${message.id}`,
        kind: message.role === "user" ? "user" : "assistant",
        message,
        events,
        seq: minSequence(events),
      },
    });
    if (message.role !== "user") assistantOrders.push(order);
  }

  const lastOrder = index === 0 ? 0 : index - 1;
  // Orphan tools (no streaming seq, no resolvable parent) belong to assistant activity, so
  // default to the LAST assistant turn — never a trailing user message (which would drop a
  // prior run's tool calls below a freshly-sent message).
  const lastAssistantOrder =
    assistantOrders.length > 0 ? assistantOrders[assistantOrders.length - 1] : lastOrder;
  const toolsAfter = new Map<number, number>();
  for (const call of state.tools.calls) {
    const events = eventsByTool.get(call.id) ?? [];
    const seq = seqByTool.get(call.id);
    let anchor = lastAssistantOrder;
    const refId = call.parentMessageId ?? call.provenance?.messageId;
    const refOrder = refId !== undefined ? orderByMessageId.get(refId) : undefined;
    if (refOrder !== undefined) {
      anchor = refOrder;
    } else if (seq !== undefined && assistantOrders.length > 0) {
      // streaming: slot after the assistant turn of the call's run (via RUN_STARTED seqs)
      let runIndex = 0;
      for (const start of runStartSeqs) if (start <= seq) runIndex += 1;
      runIndex = Math.min(Math.max(runIndex - 1, 0), assistantOrders.length - 1);
      anchor = assistantOrders[runIndex];
    }
    const placed = (toolsAfter.get(anchor) ?? 0) + 1;
    toolsAfter.set(anchor, placed);
    ordered.push({
      row: { key: `tool:${call.id}`, kind: "tool", toolCall: call, events, seq },
      order: anchor + placed / 1000,
    });
  }

  ordered.sort((left, right) => left.order - right.order);
  const rows = ordered.map((entry) => entry.row);

  for (const approval of selectPendingApprovals(state)) {
    rows.push({ key: `approval:${approval.requestId}`, kind: "approval", approval, events: [] });
  }

  if (depth !== "read") {
    for (const entry of state.memory.entries) {
      if (!isTimelineMemoryEntry(entry)) continue;
      rows.push({ key: `memory:${entry.id}`, kind: "memory", memory: entry, events: [] });
    }
  }

  if (depth === "strata") {
    const leftover = state.debug.events.filter((event) => !matched.has(event));
    if (leftover.length > 0) {
      rows.push({ key: "events:run", kind: "event", events: leftover });
    }
  }

  return rows;
}

function isTimelineMemoryEntry(entry: WorkbenchObservationMemoryEntry): boolean {
  if (entry.status !== "activated") return true;
  const text = `${entry.id} ${entry.title ?? ""} ${entry.summary ?? ""}`.toLowerCase();
  return !(
    text.includes("config") ||
    text.includes("configured") ||
    text.includes("configuration")
  );
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function messageText(message: WorkbenchMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .map((part) =>
      part.kind === "text" || part.kind === "reasoning" || part.kind === "thought" ? part.text : "",
    )
    .join("")
    .trim();
}
