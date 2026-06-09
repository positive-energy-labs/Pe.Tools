import type { HarnessEvent, HarnessMessage } from "@mastra/core/harness";
import {
  sanitizeJson,
  sanitizeRecord,
  toPeaRuntimeError,
  type PeaJsonObject,
  type PeaRuntimeEvent,
} from "./pea-runtime-events.js";

export class MastraHarnessToPeaRuntimeEvents {
  private readonly messageTextById = new Map<string, string>();
  private readonly startedMessageIds = new Set<string>();
  private readonly finishedMessageIds = new Set<string>();
  private readonly toolNamesById = new Map<string, string>();

  translate(event: HarnessEvent): PeaRuntimeEvent[] {
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
        this.toolNamesById.set(event.toolCallId, event.toolName);
        return [
          {
            type: "tool_started",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "streaming_input",
          },
        ];
      case "tool_input_delta":
        if (event.toolName) this.toolNamesById.set(event.toolCallId, event.toolName);
        return [
          {
            type: "tool_input_delta",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            delta: event.argsTextDelta,
          },
        ];
      case "tool_input_end":
        return [{ type: "tool_input_finished", toolCallId: event.toolCallId }];
      case "tool_start":
        this.toolNamesById.set(event.toolCallId, event.toolName);
        return [
          {
            type: "tool_started",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "running",
            input: sanitizeJson(event.args),
          },
        ];
      case "tool_approval_required":
        this.toolNamesById.set(event.toolCallId, event.toolName);
        return [
          {
            type: "tool_started",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "pending_approval",
            input: sanitizeJson(event.args),
          },
        ];
      case "tool_suspended":
        this.toolNamesById.set(event.toolCallId, event.toolName);
        return [
          {
            type: "tool_started",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "suspended",
            input: sanitizeJson(event.args),
            suspendPayload: sanitizeJson(event.suspendPayload),
            resumeSchema: event.resumeSchema,
          },
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
      case "tool_end":
        return [
          stripUndefined({
            type: "tool_finished",
            toolCallId: event.toolCallId,
            toolName: this.toolNamesById.get(event.toolCallId),
            result: sanitizeJson(event.result),
            isError: event.isError,
            providerMetadata: event.providerMetadata
              ? sanitizeRecord(event.providerMetadata)
              : undefined,
          }),
        ];
      case "task_updated":
        return [{ type: "plan_updated", tasks: sanitizeJson(event.tasks) }];
      case "plan_approval_required":
        return [{ type: "plan_requested", title: event.title, plan: event.plan }];
      case "subagent_tool_start":
        return [this.translateSubagentToolStart(sanitizeRecord(event))];
      case "subagent_tool_end":
        return [this.translateSubagentToolEnd(sanitizeRecord(event))];
      case "error":
        return [
          {
            type: "runtime_error",
            source: "error",
            error: toPeaRuntimeError(event.error, {
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
            error: toPeaRuntimeError(event.error),
          },
        ];
      case "om_observation_failed":
      case "om_reflection_failed":
      case "om_buffering_failed":
        return [
          {
            type: "runtime_error",
            source: event.type,
            error: toPeaRuntimeError(event.error, { details: sanitizeRecord(event) }),
          },
        ];
      default:
        return [];
    }
  }

  private translateMessage(message: HarnessMessage, finished: boolean): PeaRuntimeEvent[] {
    if (message.role !== "assistant") return [];

    const events: PeaRuntimeEvent[] = [];
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
      events.push({ type: "assistant_message_finished", messageId: message.id });
    }

    return events;
  }

  private translateSubagentToolStart(payload: PeaJsonObject): PeaRuntimeEvent {
    const ids = subagentToolIdentity(payload);
    this.toolNamesById.set(ids.toolCallId, ids.toolName);
    return {
      type: "tool_started",
      toolCallId: ids.toolCallId,
      toolName: ids.toolName,
      title: ids.title,
      status: "running",
      input: payload.args ?? payload.subToolArgs,
    };
  }

  private translateSubagentToolEnd(payload: PeaJsonObject): PeaRuntimeEvent {
    const ids = subagentToolIdentity(payload);
    return {
      type: "tool_finished",
      toolCallId: ids.toolCallId,
      toolName: ids.toolName,
      title: ids.title,
      result: payload.subToolResult ?? payload.result,
      isError: payload.isError === true,
    };
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

function subagentToolIdentity(payload: PeaJsonObject): {
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

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
