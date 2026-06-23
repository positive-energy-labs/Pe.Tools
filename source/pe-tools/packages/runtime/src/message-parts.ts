import type { RuntimeThreadMessagePart } from "./runtime.ts";

export function normalizeRuntimeMessageParts(content: unknown): RuntimeThreadMessagePart[] {
  const value = parseJsonContent(content);
  const parts = rawParts(value);
  return parts.flatMap(normalizeRuntimeMessagePart);
}

export function runtimeMessageText(content: unknown): string {
  const value = parseJsonContent(content);
  if (typeof value === "string") return value;
  const record = readRecord(value);
  if (typeof record?.content === "string") return record.content;
  return normalizeRuntimeMessageParts(value)
    .map((part) => (part.type === "text" || part.type === "thinking" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function parseRuntimeRawContent(content: unknown): unknown {
  const parsed = parseJsonContent(content);
  return typeof parsed === "string" && parsed === content ? undefined : parsed;
}

export function hasRuntimeToolParts(content: unknown): boolean {
  return normalizeRuntimeMessageParts(content).some(
    (part) => part.type === "tool-call" || part.type === "tool-result",
  );
}

function normalizeRuntimeMessagePart(part: unknown): RuntimeThreadMessagePart[] {
  const record = readRecord(part);
  if (!record) return [];
  const type = record.type;

  if (type === "text" && typeof record.text === "string") {
    return [{ type: "text", text: record.text }];
  }
  if (
    (type === "reasoning" || type === "thinking") &&
    (typeof record.text === "string" || typeof record.reasoning === "string")
  ) {
    const text = typeof record.text === "string" ? record.text : (record.reasoning as string);
    return [{ type: "thinking", text }];
  }
  if (type === "data-om-status") {
    return [{ type: "om-status", data: record.data ?? {} }];
  }
  if (
    type === "tool-call" &&
    typeof record.toolCallId === "string" &&
    typeof record.toolName === "string"
  ) {
    return [
      {
        type: "tool-call",
        toolCallId: record.toolCallId,
        toolName: record.toolName,
        ...(record.args !== undefined ? { args: record.args } : {}),
      },
    ];
  }
  if (type === "tool-result" && typeof record.toolCallId === "string") {
    return [
      {
        type: "tool-result",
        toolCallId: record.toolCallId,
        ...(typeof record.toolName === "string" ? { toolName: record.toolName } : {}),
        ...(record.result !== undefined ? { result: record.result } : {}),
        ...(record.isError === true ? { isError: true } : {}),
      },
    ];
  }
  if (type === "tool-invocation") return normalizeToolInvocation(record.toolInvocation);

  return [{ type: "raw", raw: part }];
}

function normalizeToolInvocation(value: unknown): RuntimeThreadMessagePart[] {
  const invocation = readRecord(value);
  if (
    !invocation ||
    typeof invocation.toolCallId !== "string" ||
    typeof invocation.toolName !== "string"
  ) {
    return [];
  }

  if (invocation.state === "result") {
    const parts: RuntimeThreadMessagePart[] = [];
    if (invocation.args !== undefined) {
      parts.push({
        type: "tool-call",
        toolCallId: invocation.toolCallId,
        toolName: invocation.toolName,
        args: invocation.args,
      });
    }
    parts.push({
      type: "tool-result",
      toolCallId: invocation.toolCallId,
      toolName: invocation.toolName,
      ...(invocation.result !== undefined ? { result: invocation.result } : {}),
      ...(invocation.isError === true ? { isError: true } : {}),
    });
    return parts;
  }

  return [
    {
      type: "tool-call",
      toolCallId: invocation.toolCallId,
      toolName: invocation.toolName,
      ...(invocation.args !== undefined ? { args: invocation.args } : {}),
    },
  ];
}

function rawParts(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = readRecord(value);
  return Array.isArray(record?.parts) ? record.parts : [];
}

function parseJsonContent(content: unknown): unknown {
  if (typeof content !== "string") return content;
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return content;
    }
  }
  return content;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
