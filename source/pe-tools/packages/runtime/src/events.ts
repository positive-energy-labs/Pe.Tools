import type { RuntimeToolMetadata } from "@pe/agent-contracts";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
