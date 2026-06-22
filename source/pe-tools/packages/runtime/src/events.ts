import type { HarnessEvent, HarnessMessage } from "@mastra/core/harness";
import type { PeWorkbenchUpdateMetadata } from "@pe/agent-contracts";
import {
  resolveRuntimeToolMetadata,
  type RuntimeToolMetadata,
  type RuntimeToolSource,
} from "./tool-metadata.ts";

export type RuntimeJsonValue =
  | string
  | number
  | boolean
  | null
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue };

export type RuntimeJsonObject = { [key: string]: RuntimeJsonValue };

export type RuntimeProtocol = "tui" | "acp" | "ag-ui" | "test";

export type RuntimeToolStatus = "streaming_input" | "running" | "pending_approval" | "suspended";

export interface RuntimeError {
  name: string;
  message: string;
  stack?: string;
  errorType?: string;
  retryable?: boolean;
  retryDelay?: number;
  details?: RuntimeJsonValue;
}

export type RuntimeEvent =
  | { type: "run_started" }
  | {
      type: "run_finished";
      reason?: "complete" | "aborted" | "error" | "suspended";
    }
  | { type: "assistant_message_started"; messageId: string }
  | { type: "assistant_message_delta"; messageId: string; delta: string }
  | { type: "assistant_message_finished"; messageId: string }
  | {
      type: "tool_started";
      toolCallId: string;
      toolName: string;
      title?: string;
      status: RuntimeToolStatus;
      input?: RuntimeJsonValue;
      suspendPayload?: RuntimeJsonValue;
      resumeSchema?: RuntimeJsonValue;
      tool?: RuntimeToolMetadata;
    }
  | {
      type: "tool_input_delta";
      toolCallId: string;
      toolName?: string;
      delta: string;
      tool?: RuntimeToolMetadata;
    }
  | { type: "tool_input_finished"; toolCallId: string }
  | { type: "tool_updated"; toolCallId: string; partialResult?: RuntimeJsonValue }
  | {
      type: "tool_shell_output";
      toolCallId: string;
      output: string;
      stream?: "stdout" | "stderr";
    }
  | {
      type: "tool_finished";
      toolCallId: string;
      toolName?: string;
      title?: string;
      result?: RuntimeJsonValue;
      isError: boolean;
      providerMetadata?: RuntimeJsonObject;
      tool?: RuntimeToolMetadata;
    }
  | { type: "plan_updated"; tasks: RuntimeJsonValue }
  | { type: "plan_requested"; title: string; plan: string }
  | { type: "workbench_metadata_updated"; metadata: PeWorkbenchUpdateMetadata }
  | { type: "runtime_error"; source: string; error: RuntimeError };

export function toRuntimeError(
  error: unknown,
  options: {
    message?: string;
    errorType?: string;
    retryable?: boolean;
    retryDelay?: number;
    details?: unknown;
  } = {},
): RuntimeError {
  if (error instanceof Error) {
    return stripUndefined({
      name: error.name || "Error",
      message: error.message || options.message || "Unknown error.",
      stack: error.stack,
      errorType: options.errorType,
      retryable: options.retryable,
      retryDelay: options.retryDelay,
      details: options.details === undefined ? undefined : sanitizeJson(options.details),
    });
  }

  if (typeof error === "string") {
    return stripUndefined({
      name: "Error",
      message: error,
      errorType: options.errorType,
      retryable: options.retryable,
      retryDelay: options.retryDelay,
      details: options.details === undefined ? undefined : sanitizeJson(options.details),
    });
  }

  if (hasStringProperty(error, "message")) {
    return stripUndefined({
      name: hasStringProperty(error, "name") ? error.name : "Error",
      message: error.message,
      errorType: options.errorType,
      retryable: options.retryable,
      retryDelay: options.retryDelay,
      details: sanitizeJson(options.details ?? error),
    });
  }

  return stripUndefined({
    name: "Error",
    message: options.message ?? "Unknown error.",
    errorType: options.errorType,
    retryable: options.retryable,
    retryDelay: options.retryDelay,
    details: sanitizeJson(options.details ?? error),
  });
}

export interface MastraHarnessToRuntimeEventsOptions {
  toolCatalog?: RuntimeToolSource;
}

export class MastraHarnessToRuntimeEvents {
  private readonly messageTextById = new Map<string, string>();
  private readonly startedMessageIds = new Set<string>();
  private readonly finishedMessageIds = new Set<string>();
  private readonly toolNamesById = new Map<string, string>();
  private readonly toolMetadataById = new Map<string, RuntimeToolMetadata>();

  constructor(private readonly options: MastraHarnessToRuntimeEventsOptions = {}) {}

  translate(event: HarnessEvent): RuntimeEvent[] {
    const planRequest = readPlanApprovalRequiredEvent(event);
    if (planRequest)
      return [{ type: "plan_requested", title: planRequest.title, plan: planRequest.plan }];

    switch (event.type) {
      case "agent_start":
        return [{ type: "run_started" }];
      case "agent_end":
        return [{ type: "run_finished", reason: event.reason }];
      case "message_start":
      case "message_update":
      case "message_end":
        return this.translateMessage(event.message, event.type === "message_end");
      case "tool_input_start":
        return [
          stripUndefined({
            type: "tool_started",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "streaming_input",
            tool: this.rememberTool(event.toolCallId, event.toolName),
          }),
        ];
      case "tool_input_delta":
        return [
          stripUndefined({
            type: "tool_input_delta",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            delta: event.argsTextDelta,
            tool: this.rememberTool(event.toolCallId, event.toolName),
          }),
        ];
      case "tool_input_end":
        return [{ type: "tool_input_finished", toolCallId: event.toolCallId }];
      case "tool_start":
        return [
          stripUndefined({
            type: "tool_started",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "running",
            input: sanitizeJson(event.args),
            tool: this.rememberTool(event.toolCallId, event.toolName),
          }),
        ];
      case "tool_approval_required":
        return [
          stripUndefined({
            type: "tool_started",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "pending_approval",
            input: sanitizeJson(event.args),
            tool: this.rememberTool(event.toolCallId, event.toolName),
          }),
        ];
      case "tool_suspended":
        return [
          stripUndefined({
            type: "tool_started",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "suspended",
            input: sanitizeJson(event.args),
            suspendPayload: sanitizeJson(event.suspendPayload),
            resumeSchema:
              event.resumeSchema === undefined ? undefined : sanitizeJson(event.resumeSchema),
            tool: this.rememberTool(event.toolCallId, event.toolName),
          }),
        ];
      case "tool_update":
        return [
          {
            type: "tool_updated",
            toolCallId: event.toolCallId,
            partialResult: sanitizeJson(event.partialResult),
          },
        ];
      case "shell_output":
        return [
          {
            type: "tool_shell_output",
            toolCallId: event.toolCallId,
            output: event.output,
            stream: event.stream,
          },
        ];
      case "tool_end": {
        const toolName = this.toolNamesById.get(event.toolCallId);
        return [
          stripUndefined({
            type: "tool_finished",
            toolCallId: event.toolCallId,
            toolName,
            result: sanitizeJson(event.result),
            isError: event.isError,
            providerMetadata: event.providerMetadata
              ? sanitizeRecord(event.providerMetadata)
              : undefined,
            tool: this.rememberTool(event.toolCallId, toolName),
          }),
        ];
      }
      case "task_updated":
        return [{ type: "plan_updated", tasks: sanitizeJson(event.tasks) }];
      case "subagent_tool_start":
        return [this.translateSubagentToolStart(sanitizeRecord(event))];
      case "subagent_tool_end":
        return [this.translateSubagentToolEnd(sanitizeRecord(event))];
      case "error":
        return [
          {
            type: "runtime_error",
            source: "error",
            error: toRuntimeError(event.error, {
              errorType: event.errorType,
              retryable: event.retryable,
              retryDelay: event.retryDelay,
            }),
          },
        ];
      case "workspace_error":
        return [
          {
            type: "runtime_error",
            source: "workspace_error",
            error: toRuntimeError(event.error),
          },
        ];
      case "om_observation_failed":
      case "om_reflection_failed":
      case "om_buffering_failed":
        return [
          {
            type: "runtime_error",
            source: event.type,
            error: toRuntimeError(event.error, {
              details: sanitizeRecord(event),
            }),
          },
        ];
      default:
        return [];
    }
  }

  private rememberTool(
    toolCallId: string,
    toolName: string | undefined,
  ): RuntimeToolMetadata | undefined {
    if (toolName) this.toolNamesById.set(toolCallId, toolName);
    const metadata = resolveRuntimeToolMetadata(this.options.toolCatalog, toolName);
    if (metadata) this.toolMetadataById.set(toolCallId, metadata);
    return metadata ?? this.toolMetadataById.get(toolCallId);
  }

  private translateMessage(message: HarnessMessage, finished: boolean): RuntimeEvent[] {
    if (message.role !== "assistant") return [];

    const events: RuntimeEvent[] = [];
    if (!this.startedMessageIds.has(message.id)) {
      this.startedMessageIds.add(message.id);
      events.push({ type: "assistant_message_started", messageId: message.id });
    }

    const text = messageText(message);
    const previousText = this.messageTextById.get(message.id) ?? "";
    if (text.length > previousText.length) {
      events.push({
        type: "assistant_message_delta",
        messageId: message.id,
        delta: text.slice(previousText.length),
      });
      this.messageTextById.set(message.id, text);
    }

    if ((finished || message.stopReason) && !this.finishedMessageIds.has(message.id)) {
      this.finishedMessageIds.add(message.id);
      events.push({
        type: "assistant_message_finished",
        messageId: message.id,
      });
    }

    return events;
  }

  private translateSubagentToolStart(payload: RuntimeJsonObject): RuntimeEvent {
    const ids = subagentToolIdentity(payload);
    return stripUndefined({
      type: "tool_started",
      toolCallId: ids.toolCallId,
      toolName: ids.toolName,
      title: ids.title,
      status: "running",
      input: payload.args ?? payload.subToolArgs,
      tool: this.rememberTool(ids.toolCallId, ids.toolName),
    });
  }

  private translateSubagentToolEnd(payload: RuntimeJsonObject): RuntimeEvent {
    const ids = subagentToolIdentity(payload);
    return stripUndefined({
      type: "tool_finished",
      toolCallId: ids.toolCallId,
      toolName: ids.toolName,
      title: ids.title,
      result: payload.subToolResult ?? payload.result,
      isError: payload.isError === true,
      tool: this.rememberTool(ids.toolCallId, ids.toolName),
    });
  }
}

function messageText(message: HarnessMessage): string {
  return message.content
    .map((content) => {
      const record: Record<string, unknown> = isRecord(content) ? content : {};
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .join("");
}

function subagentToolIdentity(payload: RuntimeJsonObject): {
  toolCallId: string;
  toolName: string;
  title: string;
} {
  const parentId =
    stringValue(payload.parentToolCallId) || stringValue(payload.toolCallId) || "subagent";
  const subToolCallId =
    stringValue(payload.subToolCallId) ||
    stringValue(payload.subToolName) ||
    stringValue(payload.toolCallId) ||
    "tool";
  const agentType = stringValue(payload.agentType) || "subagent";
  const toolName = stringValue(payload.subToolName) || stringValue(payload.toolName) || "tool_call";
  return {
    toolCallId: `subagent:${parentId}:${subToolCallId}`,
    toolName,
    title: `subagent: ${agentType} -> ${toolName}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function sanitizeJson(value: unknown): RuntimeJsonValue {
  return sanitizeUnknown(value, new WeakSet());
}

export function sanitizeRecord(value: unknown): RuntimeJsonObject {
  const sanitized = sanitizeJson(value);
  return isJsonObject(sanitized) ? sanitized : {};
}

function sanitizeUnknown(value: unknown, seen: WeakSet<object>): RuntimeJsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isNaN(value) ? null : value;
    case "undefined":
      return null;
    case "bigint":
      return value.toString();
    case "symbol":
      return value.description ?? value.toString();
    case "function":
      return `[Function ${value.name || "anonymous"}]`;
    case "object":
      return sanitizeObject(value, seen);
  }
  return null;
}

function sanitizeObject(value: object, seen: WeakSet<object>): RuntimeJsonValue {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return sanitizeRecord(toRuntimeError(value));
  if (seen.has(value)) return "[Circular]";

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeUnknown(item, seen));
    }

    if (value instanceof Map) {
      const result: RuntimeJsonObject = {};
      for (const [key, mapValue] of value.entries()) {
        result[String(key)] = sanitizeUnknown(mapValue, seen);
      }
      return result;
    }

    if (value instanceof Set) {
      return Array.from(value, (item) => sanitizeUnknown(item, seen));
    }

    const result: RuntimeJsonObject = {};
    for (const [key, objectValue] of Object.entries(value)) {
      result[key] = sanitizeUnknown(objectValue, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const result = { ...value };
  for (const key of Object.keys(result)) {
    if (result[key] === undefined) delete result[key];
  }
  return result;
}

function readPlanApprovalRequiredEvent(
  event: HarnessEvent,
): { title: string; plan: string } | undefined {
  const record = readRecord(event);
  if (record.type !== "plan_approval_required") return undefined;
  const title = record.title;
  const plan = record.plan;
  return typeof title === "string" && typeof plan === "string" ? { title, plan } : undefined;
}

function isJsonObject(value: RuntimeJsonValue): value is RuntimeJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStringProperty<T extends string>(
  value: unknown,
  property: T,
): value is Record<T, string> {
  const record = readRecord(value);
  return typeof record[property] === "string";
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
