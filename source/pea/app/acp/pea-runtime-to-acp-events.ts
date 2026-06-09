import type { SessionUpdate, ToolCallStatus } from "@agentclientprotocol/sdk";
import type { PeaJsonValue, PeaRuntimeEvent } from "../pea-runtime-events.js";
import { toAcpToolKind, toAcpToolTitle } from "./tool-kind.js";

export class PeaRuntimeToAcpEvents {
  private readonly startedToolIds = new Set<string>();
  private readonly toolNamesById = new Map<string, string>();
  private readonly toolTitlesById = new Map<string, string>();

  translate(event: PeaRuntimeEvent): SessionUpdate[] {
    switch (event.type) {
      case "assistant_message_delta":
        return [
          {
            sessionUpdate: "agent_message_chunk",
            messageId: event.messageId,
            content: { type: "text", text: event.delta },
          },
        ];
      case "tool_started":
        return [this.toolStarted(event)];
      case "tool_input_delta":
        return [
          this.toolUpdate({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: "in_progress",
            rawOutput: event.delta,
            contentText: event.delta,
          }),
        ];
      case "tool_updated":
        return [
          this.toolUpdate({
            toolCallId: event.toolCallId,
            status: "in_progress",
            rawOutput: event.partialResult,
            contentText: valuePreview(event.partialResult),
          }),
        ];
      case "tool_shell_output":
        return [
          this.toolUpdate({
            toolCallId: event.toolCallId,
            status: "in_progress",
            rawOutput: event.output,
            contentText: event.output,
          }),
        ];
      case "tool_finished":
        return [
          this.toolUpdate({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            title: event.title,
            status: event.isError ? "failed" : "completed",
            rawOutput: event.result,
            contentText: valuePreview(event.result),
          }),
        ];
      case "plan_updated":
        return [tasksToPlan(event.tasks)];
      case "plan_requested":
        return [markdownPlanToAcpPlan(event.plan, event.title)];
      default:
        return [];
    }
  }

  private toolStarted(event: Extract<PeaRuntimeEvent, { type: "tool_started" }>): SessionUpdate {
    this.toolNamesById.set(event.toolCallId, event.toolName);
    if (event.title) this.toolTitlesById.set(event.toolCallId, event.title);

    const status = toAcpToolStatus(event.status);
    if (this.startedToolIds.has(event.toolCallId)) {
      return this.toolUpdate({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        title: event.title,
        status,
        rawInput: event.input,
        rawOutput: event.input,
        contentText: valuePreview(event.input),
      });
    }

    this.startedToolIds.add(event.toolCallId);
    return {
      sessionUpdate: "tool_call",
      toolCallId: event.toolCallId,
      title: event.title ?? toAcpToolTitle(event.toolName),
      kind: toAcpToolKind(event.toolName),
      status,
      rawInput: event.input,
      content: event.input ? content(valuePreview(event.input)) : [],
    };
  }

  private toolUpdate(update: {
    toolCallId: string;
    toolName?: string;
    title?: string;
    status: ToolCallStatus;
    rawInput?: PeaJsonValue;
    rawOutput?: PeaJsonValue;
    contentText?: string;
  }): SessionUpdate {
    if (update.toolName) this.toolNamesById.set(update.toolCallId, update.toolName);
    if (update.title) this.toolTitlesById.set(update.toolCallId, update.title);
    const toolName = update.toolName || this.toolNamesById.get(update.toolCallId) || "tool_call";
    const title =
      update.title || this.toolTitlesById.get(update.toolCallId) || toAcpToolTitle(toolName);

    return {
      sessionUpdate: "tool_call_update",
      toolCallId: update.toolCallId,
      title,
      kind: toAcpToolKind(toolName),
      status: update.status,
      rawInput: update.rawInput,
      rawOutput: update.rawOutput,
      content: content(update.contentText),
    };
  }
}

function toAcpToolStatus(
  status: Extract<PeaRuntimeEvent, { type: "tool_started" }>["status"],
): ToolCallStatus {
  switch (status) {
    case "pending_approval":
    case "suspended":
      return "pending";
    default:
      return "in_progress";
  }
}

function tasksToPlan(tasks: PeaJsonValue): SessionUpdate {
  const entries = Array.isArray(tasks) ? tasks : [];
  return {
    sessionUpdate: "plan",
    entries: entries.map((entry, index) => {
      const task = isObject(entry) ? entry : {};
      const status =
        task.status === "completed" || task.status === "in_progress" ? task.status : "pending";
      return {
        content: stringValue(task.content) || stringValue(task.activeForm) || `Step ${index + 1}`,
        priority: "medium",
        status,
      };
    }),
  };
}

function markdownPlanToAcpPlan(plan: string, title: string): SessionUpdate {
  const lines = plan
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line));
  return {
    sessionUpdate: "plan",
    entries: (lines.length ? lines : [title]).map((line) => ({
      content: line.replace(/^[-*]\s+/, ""),
      priority: "medium",
      status: "pending",
    })),
  };
}

function content(
  text: string | undefined,
): NonNullable<Extract<SessionUpdate, { sessionUpdate: "tool_call" }>["content"]> {
  return text ? [{ type: "content", content: { type: "text", text } }] : [];
}

function valuePreview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function isObject(value: unknown): value is Record<string, PeaJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
