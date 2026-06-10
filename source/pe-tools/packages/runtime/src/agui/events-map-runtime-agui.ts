import { EventType, type BaseEvent } from "@ag-ui/core";
import type { RuntimeEvent } from "../events.ts";

export class RuntimeToAgUiEvents {
  private readonly startedMessageIds = new Set<string>();
  private readonly finishedMessageIds = new Set<string>();
  private readonly startedToolIds = new Set<string>();
  private readonly finishedToolIds = new Set<string>();
  private readonly toolNamesById = new Map<string, string>();

  translate(event: RuntimeEvent): BaseEvent[] {
    switch (event.type) {
      case "assistant_message_started":
        return this.startMessage(event.messageId);
      case "assistant_message_delta":
        return [
          ...this.startMessage(event.messageId),
          {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: event.messageId,
            delta: event.delta,
          },
        ];
      case "assistant_message_finished":
        return this.finishMessage(event.messageId);
      case "tool_started":
        this.toolNamesById.set(event.toolCallId, event.toolName);
        return [
          ...this.startTool(event.toolCallId, event.toolName),
          ...(event.input === undefined
            ? []
            : [
                {
                  type: EventType.TOOL_CALL_ARGS,
                  toolCallId: event.toolCallId,
                  delta: stringify(event.input),
                } satisfies BaseEvent,
              ]),
        ];
      case "tool_input_delta":
        return [
          ...this.startTool(
            event.toolCallId,
            event.toolName || this.toolNamesById.get(event.toolCallId) || "tool_call",
          ),
          {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: event.toolCallId,
            delta: event.delta,
          },
        ];
      case "tool_updated":
        return customToolEvent("runtime.tool.update", event.toolCallId, event.partialResult);
      case "tool_shell_output":
        return customToolEvent("runtime.tool.shell_output", event.toolCallId, {
          output: event.output,
          stream: event.stream,
        });
      case "tool_finished":
        return [
          ...this.finishTool(event.toolCallId),
          {
            type: EventType.TOOL_CALL_RESULT,
            messageId: `${event.toolCallId}:result`,
            toolCallId: event.toolCallId,
            content: stringify(event.result),
            role: "tool",
          },
        ];
      case "plan_updated":
        return [
          {
            type: EventType.CUSTOM,
            name: "runtime.plan.updated",
            value: event.tasks,
          },
        ];
      case "plan_requested":
        return [
          {
            type: EventType.CUSTOM,
            name: "runtime.plan.requested",
            value: { title: event.title, plan: event.plan },
          },
        ];
      case "runtime_error":
        return [
          {
            type: EventType.CUSTOM,
            name: "runtime.error",
            value: { source: event.source, error: event.error },
          },
        ];
      default:
        return [];
    }
  }

  private startMessage(messageId: string): BaseEvent[] {
    if (this.startedMessageIds.has(messageId)) return [];
    this.startedMessageIds.add(messageId);
    return [{ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" }];
  }

  private finishMessage(messageId: string): BaseEvent[] {
    if (!this.startedMessageIds.has(messageId) || this.finishedMessageIds.has(messageId)) return [];
    this.finishedMessageIds.add(messageId);
    return [{ type: EventType.TEXT_MESSAGE_END, messageId }];
  }

  private startTool(toolCallId: string, toolName: string): BaseEvent[] {
    this.toolNamesById.set(toolCallId, toolName);
    if (this.startedToolIds.has(toolCallId)) return [];
    this.startedToolIds.add(toolCallId);
    return [
      {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: toolName,
        parentMessageId: toolCallId,
      },
    ];
  }

  private finishTool(toolCallId: string): BaseEvent[] {
    if (this.finishedToolIds.has(toolCallId)) return [];
    this.finishedToolIds.add(toolCallId);
    return [{ type: EventType.TOOL_CALL_END, toolCallId }];
  }
}

export { RuntimeToAgUiEvents as PeaRuntimeToAgUiEvents };

function customToolEvent(name: string, toolCallId: string, value: unknown): BaseEvent[] {
  return [{ type: EventType.CUSTOM, name, value: { toolCallId, value } }];
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null);
}
