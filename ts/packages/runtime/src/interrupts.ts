import { sanitizeJson, type RuntimeJsonValue } from "./events.ts";

export interface RuntimeResumeDecision {
  interruptId: string;
  status: "resolved" | "cancelled";
  payload?: RuntimeJsonValue;
}

export function readRuntimeResumeDecisions(value: unknown): RuntimeResumeDecision[] {
  return Array.isArray(value) ? value.map(readRuntimeResumeDecision).filter(isDefined) : [];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function withoutUndefinedResumeDecision(value: RuntimeResumeDecision): RuntimeResumeDecision {
  return {
    interruptId: value.interruptId,
    status: value.status,
    ...(value.payload !== undefined ? { payload: value.payload } : {}),
  };
}

function readRuntimeResumeDecision(value: unknown): RuntimeResumeDecision | undefined {
  if (!isPlainRecord(value)) return undefined;
  if (typeof value.interruptId !== "string") return undefined;
  if (value.status !== "resolved" && value.status !== "cancelled") return undefined;
  return withoutUndefinedResumeDecision({
    interruptId: value.interruptId,
    status: value.status,
    payload: value.payload === undefined ? undefined : sanitizeJson(value.payload),
  });
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
