export type PeaJsonValue =
  | string
  | number
  | boolean
  | null
  | PeaJsonValue[]
  | { [key: string]: PeaJsonValue };

export type PeaJsonObject = { [key: string]: PeaJsonValue };

export type PeaRuntimeProtocol = "tui" | "acp" | "ag-ui" | "test";

export type PeaRuntimeToolStatus = "streaming_input" | "running" | "pending_approval" | "suspended";

export interface PeaRuntimeError {
  name: string;
  message: string;
  stack?: string;
  errorType?: string;
  retryable?: boolean;
  retryDelay?: number;
  details?: PeaJsonValue;
}

export type PeaRuntimeEvent =
  | { type: "run_started" }
  | { type: "run_finished"; reason?: "complete" | "aborted" | "error" | "suspended" }
  | { type: "assistant_message_started"; messageId: string }
  | { type: "assistant_message_delta"; messageId: string; delta: string }
  | { type: "assistant_message_finished"; messageId: string }
  | {
      type: "tool_started";
      toolCallId: string;
      toolName: string;
      title?: string;
      status: PeaRuntimeToolStatus;
      input?: PeaJsonValue;
      suspendPayload?: PeaJsonValue;
      resumeSchema?: unknown;
    }
  | { type: "tool_input_delta"; toolCallId: string; toolName?: string; delta: string }
  | { type: "tool_input_finished"; toolCallId: string }
  | { type: "tool_updated"; toolCallId: string; partialResult?: PeaJsonValue }
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
      result?: PeaJsonValue;
      isError: boolean;
      providerMetadata?: PeaJsonObject;
    }
  | { type: "plan_updated"; tasks: PeaJsonValue }
  | { type: "plan_requested"; title: string; plan: string }
  | { type: "runtime_error"; source: string; error: PeaRuntimeError };

export function sanitizeJson(value: unknown): PeaJsonValue {
  return sanitizeUnknown(value, new WeakSet());
}

export function sanitizeRecord(value: unknown): PeaJsonObject {
  const sanitized = sanitizeJson(value);
  return isJsonObject(sanitized) ? sanitized : {};
}

export function toPeaRuntimeError(
  error: unknown,
  options: {
    message?: string;
    errorType?: string;
    retryable?: boolean;
    retryDelay?: number;
    details?: unknown;
  } = {},
): PeaRuntimeError {
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

function sanitizeUnknown(value: unknown, seen: WeakSet<object>): PeaJsonValue {
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

function sanitizeObject(value: object, seen: WeakSet<object>): PeaJsonValue {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return sanitizeRecord(toPeaRuntimeError(value));
  if (seen.has(value)) return "[Circular]";

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeUnknown(item, seen));
    }

    if (value instanceof Map) {
      const result: PeaJsonObject = {};
      for (const [key, mapValue] of value.entries()) {
        result[String(key)] = sanitizeUnknown(mapValue, seen);
      }
      return result;
    }

    if (value instanceof Set) {
      return Array.from(value, (item) => sanitizeUnknown(item, seen));
    }

    const result: PeaJsonObject = {};
    for (const [key, objectValue] of Object.entries(value)) {
      result[key] = sanitizeUnknown(objectValue, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isJsonObject(value: PeaJsonValue): value is PeaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStringProperty<T extends string>(
  value: unknown,
  property: T,
): value is Record<T, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<T, unknown>)[property] === "string"
  );
}
