import type { PermissionOptionKind, ToolCallStatus } from "@agentclientprotocol/sdk";
import type {
  PeWorkbenchUpdateMetadata,
  WorkbenchApprovalOption,
  WorkbenchApprovalRequest,
  WorkbenchEvent,
  WorkbenchInspectorEntry,
  WorkbenchMessage,
  WorkbenchMessagePart,
  WorkbenchPlanEntry,
  WorkbenchProvenance,
  WorkbenchRole,
  WorkbenchRunStatus,
  WorkbenchToolCall,
} from "@pe/agent-contracts";
import type { RuntimeEvent, RuntimeJsonValue, RuntimeToolStatus } from "../events.ts";
import type { RuntimeThreadMessage } from "../runtime.ts";

/** Stable interrupt id a `tool_started` pending/suspended event maps to (matches the runtime collector). */
export function approvalRequestId(toolCallId: string, suspended: boolean): string {
  return `${suspended ? "tool-suspended" : "tool-approval"}:${toolCallId}`;
}

const APPROVAL_OPTIONS: WorkbenchApprovalOption[] = [
  { optionId: "allow_once", name: "Approve", kind: "allow_once" as PermissionOptionKind },
  { optionId: "allow_always", name: "Always", kind: "allow_always" as PermissionOptionKind },
  { optionId: "reject_once", name: "Deny", kind: "reject_once" as PermissionOptionKind },
];

/** Resolve options expose `allow_*` as approval; the `/approve` route maps the rest to cancellation. */
export function isApprovalOptionAllowed(optionId: string | undefined): boolean {
  return optionId === undefined ? false : optionId.startsWith("allow");
}

export interface RuntimeToWorkbenchOptions {
  sessionId?: string;
  threadId?: string;
}

/**
 * Translates the canonical `RuntimeEvent` stream into `WorkbenchEvent`s the web
 * client reduces with `applyWorkbenchEvent`. Mirrors `RuntimeToAcpEvents`: a
 * self-contained translator with its own accumulator maps — no external
 * `WorkbenchState` needed. Replaces the old two-hop `RuntimeEvent -> ag-ui ->
 * WorkbenchEvent` path.
 */
export class RuntimeToWorkbenchEvents {
  private readonly messageText = new Map<string, string>();
  private readonly toolCalls = new Map<string, WorkbenchToolCall>();
  private readonly toolInputText = new Map<string, string>();
  /** toolCallId -> open approval requestId, so we can resolve it once the tool proceeds. */
  private readonly openApprovals = new Map<string, string>();
  private activeMessageId: string | undefined;
  private sequence = 0;

  constructor(private readonly options: RuntimeToWorkbenchOptions = {}) {}

  translate(event: RuntimeEvent): WorkbenchEvent[] {
    // Every RuntimeEvent also becomes a sequence-numbered devtools breadcrumb so the
    // strata lane can show the canonical runtime stream. High-frequency deltas are
    // skipped (derivable from the assembled message/tool) to keep the log legible.
    const debug = this.debugEvent(event);
    return debug ? [debug, ...this.translateCore(event)] : this.translateCore(event);
  }

  private debugEvent(event: RuntimeEvent): WorkbenchEvent | undefined {
    if (
      event.type === "assistant_message_delta" ||
      event.type === "tool_input_delta" ||
      event.type === "tool_shell_output"
    ) {
      return undefined;
    }
    const sequence = ++this.sequence;
    return {
      type: "debug_event_recorded",
      debugEvent: {
        id: `runtime:${sequence}:${event.type}`,
        source: "runtime",
        type: event.type,
        label: event.type.replaceAll("_", " "),
        timestamp: nowIso(),
        payload: { sequence, ...(event as unknown as Record<string, unknown>) },
      },
    };
  }

  private approvalEvents(
    event: Extract<RuntimeEvent, { type: "tool_started" }>,
    timestamp: string,
  ): WorkbenchEvent[] {
    if (event.status !== "pending_approval" && event.status !== "suspended") return [];
    if (this.openApprovals.has(event.toolCallId)) return [];
    const requestId = approvalRequestId(event.toolCallId, event.status === "suspended");
    this.openApprovals.set(event.toolCallId, requestId);
    const approval: WorkbenchApprovalRequest = {
      requestId,
      sessionId: this.options.sessionId ?? "",
      toolCall: {
        id: event.toolCallId,
        title: event.title ?? event.toolName,
        status: "pending",
        rawInput: event.input,
      },
      options: APPROVAL_OPTIONS,
      status: "pending",
      defaultOptionId: "allow_once",
      createdAt: timestamp,
    };
    return [{ type: "approval_requested", approval }];
  }

  /** Once a tool moves past pending (resolved out-of-band), clear its approval card. */
  private resolveApprovalEvents(toolCallId: string, timestamp: string): WorkbenchEvent[] {
    const requestId = this.openApprovals.get(toolCallId);
    if (!requestId) return [];
    this.openApprovals.delete(toolCallId);
    return [{ type: "approval_resolved", requestId, resolution: { resolvedAt: timestamp } }];
  }

  private translateCore(event: RuntimeEvent): WorkbenchEvent[] {
    const timestamp = nowIso();
    switch (event.type) {
      case "run_started":
        return [{ type: "run_status_changed", status: "running", timestamp }];
      case "run_finished":
        return [{ type: "run_status_changed", status: runFinishedStatus(event.reason), timestamp }];
      case "assistant_message_started":
        this.activeMessageId = event.messageId;
        if (!this.messageText.has(event.messageId)) this.messageText.set(event.messageId, "");
        return [];
      case "assistant_message_delta": {
        this.activeMessageId = event.messageId;
        this.messageText.set(
          event.messageId,
          (this.messageText.get(event.messageId) ?? "") + event.delta,
        );
        return [
          {
            type: "message_part_delta",
            messageId: event.messageId,
            role: "assistant",
            part: { kind: "text", text: event.delta, provenance: this.provenance(event.messageId) },
            status: "streaming",
            timestamp,
            provenance: this.provenance(event.messageId),
          },
        ];
      }
      case "assistant_message_finished": {
        const text = this.messageText.get(event.messageId) ?? "";
        return [
          {
            type: "message_updated",
            message: {
              id: event.messageId,
              role: "assistant",
              parts: text ? [{ kind: "text", text }] : [],
              status: "complete",
              updatedAt: timestamp,
              provenance: this.provenance(event.messageId),
            },
          },
        ];
      }
      case "tool_started":
        return [
          this.toolCallEvent(event.toolCallId, {
            title: event.title ?? event.toolName,
            status: toToolStatus(event.status),
            rawInput: event.input,
            startedAt: timestamp,
            updatedAt: timestamp,
          }),
          ...this.approvalEvents(event, timestamp),
        ];
      case "tool_input_delta": {
        const next = (this.toolInputText.get(event.toolCallId) ?? "") + event.delta;
        this.toolInputText.set(event.toolCallId, next);
        return [
          this.toolCallEvent(event.toolCallId, {
            title: event.toolName,
            status: "in_progress",
            rawInput: next,
            updatedAt: timestamp,
          }),
        ];
      }
      case "tool_input_finished":
        return [];
      case "tool_updated":
        return [
          ...this.resolveApprovalEvents(event.toolCallId, timestamp),
          this.toolCallEvent(event.toolCallId, {
            rawOutput: event.partialResult,
            content: preview(event.partialResult),
            updatedAt: timestamp,
          }),
        ];
      case "tool_shell_output": {
        const previousContent = this.toolCalls.get(event.toolCallId)?.content;
        const content = (typeof previousContent === "string" ? previousContent : "") + event.output;
        return [
          this.toolCallEvent(event.toolCallId, {
            rawOutput: content,
            content,
            updatedAt: timestamp,
          }),
        ];
      }
      case "tool_finished":
        return [
          ...this.resolveApprovalEvents(event.toolCallId, timestamp),
          this.toolCallEvent(event.toolCallId, {
            title: event.title ?? event.toolName,
            status: event.isError ? "failed" : "completed",
            rawOutput: event.result,
            content: preview(event.result),
            error: event.isError ? preview(event.result) : undefined,
            updatedAt: timestamp,
            completedAt: timestamp,
          }),
        ];
      case "plan_updated":
        return [{ type: "plan_replaced", entries: planEntries(event.tasks) }];
      case "plan_requested":
        return [
          {
            type: "plan_replaced",
            entries: [
              {
                id: "plan:requested",
                content: event.plan || event.title || "Plan requested.",
                status: "pending",
                priority: "medium",
              },
            ],
          },
        ];
      case "workbench_metadata_updated":
        return workbenchMetadataEvents(event.metadata);
      case "runtime_error":
        return [
          { type: "error", message: event.error.message },
          { type: "run_status_changed", status: "error", timestamp },
        ];
      default:
        return [];
    }
  }

  private toolCallEvent(toolCallId: string, patch: Partial<WorkbenchToolCall>): WorkbenchEvent {
    const previous = this.toolCalls.get(toolCallId);
    const merged: WorkbenchToolCall = {
      id: toolCallId,
      title: patch.title ?? previous?.title ?? toolCallId,
      status: patch.status ?? previous?.status,
      rawInput: patch.rawInput ?? previous?.rawInput,
      rawOutput: patch.rawOutput ?? previous?.rawOutput,
      content: patch.content ?? previous?.content,
      error: patch.error ?? previous?.error,
      startedAt: previous?.startedAt ?? patch.startedAt,
      updatedAt: patch.updatedAt,
      completedAt: patch.completedAt ?? previous?.completedAt,
      parentMessageId: previous?.parentMessageId ?? this.activeMessageId,
      provenance: {
        source: "runtime",
        protocol: "workbench",
        sessionId: this.options.sessionId,
        threadId: this.options.threadId,
        toolCallId,
      },
    };
    this.toolCalls.set(toolCallId, merged);
    return { type: "tool_call_updated", toolCall: merged };
  }

  private provenance(messageId?: string): WorkbenchProvenance {
    return {
      source: "runtime",
      protocol: "workbench",
      sessionId: this.options.sessionId,
      threadId: this.options.threadId,
      messageId,
    };
  }
}

/**
 * Rebuilds `WorkbenchEvent`s from durable thread-message history for hydration on
 * page load. The message parts already carry tool-call/tool-result, so this is
 * full-fidelity (tools included) without a separate persisted event log.
 */
export function runtimeMessagesToWorkbenchEvents(
  messages: RuntimeThreadMessage[],
): WorkbenchEvent[] {
  const transcript: WorkbenchMessage[] = [];
  const toolEvents: WorkbenchEvent[] = [];
  const toolParents = new Map<string, string>();

  for (const message of messages) {
    const role = toWorkbenchRole(message.role);
    const parts: WorkbenchMessagePart[] = [];
    for (const part of message.parts ?? []) {
      // Tool-call / tool-result parts are processed regardless of message role —
      // results frequently arrive on a separate `tool`-role message, which is not
      // shown in the transcript but still carries the call's completion.
      if (part.type === "tool-call") {
        toolParents.set(part.toolCallId, message.id);
        if (role)
          parts.push({ kind: "tool_call_ref", toolCallId: part.toolCallId, label: part.toolName });
        toolEvents.push({
          type: "tool_call_updated",
          toolCall: {
            id: part.toolCallId,
            title: part.toolName,
            status: "in_progress",
            rawInput: part.args as RuntimeJsonValue,
            parentMessageId: message.id,
          },
        });
      } else if (part.type === "tool-result") {
        const content = preview(part.result);
        toolEvents.push({
          type: "tool_call_updated",
          toolCall: {
            id: part.toolCallId,
            title: part.toolName ?? part.toolCallId,
            status: part.isError ? "failed" : "completed",
            rawOutput: part.result,
            content,
            error: part.isError ? content : undefined,
            completedAt: message.createdAt,
            parentMessageId: toolParents.get(part.toolCallId),
          },
        });
      } else if (role && part.type === "text" && part.text) {
        parts.push({ kind: "text", text: part.text });
      } else if (role && part.type === "thinking" && part.text) {
        parts.push({ kind: "reasoning", text: part.text });
      }
    }
    if (role === undefined) continue;
    if (parts.length === 0 && message.text) parts.push({ kind: "text", text: message.text });
    if (parts.length === 0 && role !== "user") continue;
    transcript.push({
      id: message.id,
      role,
      parts,
      status: "complete",
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
    });
  }

  return [{ type: "transcript_replaced", messages: transcript }, ...toolEvents];
}

function workbenchMetadataEvents(metadata: PeWorkbenchUpdateMetadata): WorkbenchEvent[] {
  const events: WorkbenchEvent[] = [];

  for (const entry of toArray(metadata.debug)) {
    events.push({ type: "debug_event_recorded", debugEvent: entry });
  }
  for (const entry of toArray(metadata.observationalMemory)) {
    events.push({ type: "observational_memory_updated", entry });
  }
  if (metadata.model) events.push({ type: "model_state_updated", model: metadata.model });
  if (metadata.mode) events.push({ type: "session_mode_updated", sessionMode: metadata.mode });
  if (metadata.access) events.push({ type: "access_level_updated", access: metadata.access });

  const inspector: {
    systemPrompt?: PeWorkbenchUpdateMetadata["systemPrompt"];
    contextEntries?: WorkbenchInspectorEntry[];
    rawMessages?: WorkbenchInspectorEntry[];
  } = {};
  if (metadata.systemPrompt) inspector.systemPrompt = metadata.systemPrompt;
  if (metadata.contextEntries?.length) inspector.contextEntries = metadata.contextEntries;
  if (metadata.rawMessages?.length) inspector.rawMessages = metadata.rawMessages;
  if (Object.keys(inspector).length > 0) events.push({ type: "inspector_updated", inspector });

  if (metadata.threads) {
    events.push({
      type: "threads_replaced",
      threads: metadata.threads,
      activeThreadId: metadata.activeThreadId,
    });
  }

  return events;
}

function planEntries(value: RuntimeJsonValue): WorkbenchPlanEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((task, index) => {
    const record = isRecord(task) ? task : {};
    const status = record.status;
    const priority = record.priority;
    return {
      id: typeof record.id === "string" ? record.id : `plan:${index}`,
      content:
        stringOf(record.content) ??
        stringOf(record.activeForm) ??
        stringOf(task) ??
        `Step ${index + 1}`,
      priority: priority === "high" || priority === "low" ? priority : "medium",
      status: status === "completed" || status === "in_progress" ? status : "pending",
    };
  });
}

function toToolStatus(status: RuntimeToolStatus): ToolCallStatus {
  switch (status) {
    case "pending_approval":
    case "suspended":
      return "pending";
    default:
      return "in_progress";
  }
}

function runFinishedStatus(reason: string | undefined): WorkbenchRunStatus {
  if (reason === "suspended") return "waiting";
  if (reason === "error") return "error";
  return "idle";
}

function toWorkbenchRole(role: RuntimeThreadMessage["role"]): WorkbenchRole | undefined {
  switch (role) {
    case "user":
    case "assistant":
    case "system":
      return role;
    default:
      return undefined;
  }
}

function preview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nowIso(): string {
  return new Date().toISOString();
}
