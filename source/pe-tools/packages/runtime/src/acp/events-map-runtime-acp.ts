import type { SessionUpdate, ToolCallStatus } from "@agentclientprotocol/sdk";
import type { RuntimeEvent, RuntimeJsonValue } from "../events.ts";
import type { RuntimeToolMetadata } from "../tool-metadata.ts";
import { toAcpToolKind, toAcpToolTitle } from "./tool-kind.ts";

export class RuntimeToAcpEvents {
  private readonly startedToolIds = new Set<string>();
  private readonly toolNamesById = new Map<string, string>();
  private readonly toolTitlesById = new Map<string, string>();
  private readonly toolMetadataById = new Map<string, RuntimeToolMetadata>();

  translate(event: RuntimeEvent): SessionUpdate[] {
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
            tool: event.tool,
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
            tool: event.tool,
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

  private toolStarted(event: Extract<RuntimeEvent, { type: "tool_started" }>): SessionUpdate {
    this.toolNamesById.set(event.toolCallId, event.toolName);
    if (event.title) this.toolTitlesById.set(event.toolCallId, event.title);
    if (event.tool) this.toolMetadataById.set(event.toolCallId, event.tool);

    const status = toAcpToolStatus(event.status);
    if (this.startedToolIds.has(event.toolCallId)) {
      return this.toolUpdate({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        title: event.title,
        tool: event.tool,
        status,
        rawInput: event.input,
        rawOutput: event.input,
        contentText: valuePreview(event.input),
      });
    }

    this.startedToolIds.add(event.toolCallId);
    const tool = event.tool;
    return {
      sessionUpdate: "tool_call",
      toolCallId: event.toolCallId,
      title: toolTitle(event.toolName, event.title, tool),
      kind: toAcpToolKind(event.toolName, tool),
      status,
      rawInput: event.input,
      content: event.input ? content(valuePreview(event.input)) : [],
    };
  }

  private toolUpdate(update: {
    toolCallId: string;
    toolName?: string;
    title?: string;
    tool?: RuntimeToolMetadata;
    status: ToolCallStatus;
    rawInput?: RuntimeJsonValue;
    rawOutput?: RuntimeJsonValue;
    contentText?: string;
  }): SessionUpdate {
    if (update.toolName) this.toolNamesById.set(update.toolCallId, update.toolName);
    if (update.title) this.toolTitlesById.set(update.toolCallId, update.title);
    if (update.tool) this.toolMetadataById.set(update.toolCallId, update.tool);
    const toolName = update.toolName || this.toolNamesById.get(update.toolCallId) || "tool_call";
    const tool = update.tool || this.toolMetadataById.get(update.toolCallId);
    const title = toolTitle(
      toolName,
      update.title || this.toolTitlesById.get(update.toolCallId),
      tool,
    );

    return {
      sessionUpdate: "tool_call_update",
      toolCallId: update.toolCallId,
      title,
      kind: toAcpToolKind(toolName, tool),
      status: update.status,
      rawInput: update.rawInput,
      rawOutput: update.rawOutput,
      content: content(update.contentText),
    };
  }
}

function toolTitle(
  toolName: string,
  title: string | undefined,
  tool: RuntimeToolMetadata | undefined,
): string {
  return tool?.title ?? title ?? toAcpToolTitle(toolName);
}

function toAcpToolStatus(
  status: Extract<RuntimeEvent, { type: "tool_started" }>["status"],
): ToolCallStatus {
  switch (status) {
    case "pending_approval":
    case "suspended":
      return "pending";
    default:
      return "in_progress";
  }
}

function tasksToPlan(tasks: RuntimeJsonValue): SessionUpdate {
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

function isObject(value: unknown): value is Record<string, RuntimeJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
