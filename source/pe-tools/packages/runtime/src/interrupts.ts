import {
  sanitizeJson,
  type RuntimeJsonObject,
  type RuntimeJsonValue,
  type RuntimeEvent,
} from "./events.ts";

export type RuntimeInterruptReason =
  | "tool_approval_required"
  | "tool_suspended"
  | "plan_approval_required"
  | "runtime_suspended";

export interface RuntimeInterrupt {
  id: string;
  reason: RuntimeInterruptReason;
  message?: string;
  toolCallId?: string;
  responseSchema?: RuntimeJsonObject;
  expiresAt?: string;
  metadata?: RuntimeJsonObject;
}

export type RuntimeRunOutcome =
  | { type: "success" }
  | { type: "interrupt"; interrupts: RuntimeInterrupt[] };

export interface RuntimeResumeDecision {
  interruptId: string;
  status: "resolved" | "cancelled";
  payload?: RuntimeJsonValue;
}

export class RuntimeInterruptCollector {
  private readonly interruptsById = new Map<string, RuntimeInterrupt>();
  private planRequestCount = 0;
  private sawSuspendedRun = false;

  observe(event: RuntimeEvent): void {
    switch (event.type) {
      case "tool_started":
        this.observeToolStarted(event);
        return;
      case "plan_requested":
        this.planRequestCount += 1;
        this.addInterrupt({
          id: `plan-approval:${this.planRequestCount}`,
          reason: "plan_approval_required",
          message: event.title || "Plan approval required.",
          metadata: sanitizeObject({
            title: event.title,
            plan: event.plan,
          }),
        });
        return;
      case "run_finished":
        this.sawSuspendedRun = event.reason === "suspended" || this.sawSuspendedRun;
        return;
    }
  }

  outcome(): RuntimeRunOutcome {
    if (this.sawSuspendedRun && this.interruptsById.size === 0) {
      this.addInterrupt({
        id: "runtime-suspended",
        reason: "runtime_suspended",
        message: "Runtime suspended and is waiting for client input.",
      });
    }

    const interrupts = [...this.interruptsById.values()];
    return interrupts.length > 0 ? { type: "interrupt", interrupts } : { type: "success" };
  }

  private observeToolStarted(event: Extract<RuntimeEvent, { type: "tool_started" }>): void {
    if (event.status === "pending_approval") {
      this.addInterrupt({
        id: `tool-approval:${event.toolCallId}`,
        reason: "tool_approval_required",
        message: event.title || `${event.toolName} requires approval.`,
        toolCallId: event.toolCallId,
        responseSchema: schemaObject(event.resumeSchema),
        metadata: toolMetadata(event),
      });
      return;
    }

    if (event.status === "suspended") {
      this.addInterrupt({
        id: `tool-suspended:${event.toolCallId}`,
        reason: "tool_suspended",
        message: event.title || `${event.toolName} suspended.`,
        toolCallId: event.toolCallId,
        responseSchema: schemaObject(event.resumeSchema),
        metadata: toolMetadata(event),
      });
    }
  }

  private addInterrupt(interrupt: RuntimeInterrupt): void {
    this.interruptsById.set(interrupt.id, withoutUndefinedInterrupt(interrupt));
  }
}

export function createRuntimeResumeContextEntries(
  decisions: RuntimeResumeDecision[] | undefined,
): Array<{ description: string; value: string }> {
  if (!decisions || decisions.length === 0) return [];
  return [
    {
      description: "Runtime resume decisions",
      value: JSON.stringify(decisions.map(withoutUndefinedResumeDecision), null, 2),
    },
  ];
}

export function toRuntimeResumeDecisions(
  decisions:
    | Array<{
        interruptId: string;
        status: "resolved" | "cancelled";
        payload?: unknown;
      }>
    | undefined,
): RuntimeResumeDecision[] | undefined {
  if (!decisions || decisions.length === 0) return undefined;
  return decisions.map((decision) =>
    withoutUndefinedResumeDecision({
      interruptId: decision.interruptId,
      status: decision.status,
      payload: decision.payload === undefined ? undefined : sanitizeJson(decision.payload),
    }),
  );
}

function toolMetadata(event: Extract<RuntimeEvent, { type: "tool_started" }>): RuntimeJsonObject {
  return sanitizeObject({
    title: event.title,
    toolName: event.toolName,
    status: event.status,
    input: event.input,
    suspendPayload: event.suspendPayload,
  });
}

function schemaObject(value: unknown): RuntimeJsonObject | undefined {
  if (!isPlainRecord(value)) return undefined;
  return sanitizeObject(value);
}

function sanitizeObject(value: Record<string, unknown>): RuntimeJsonObject {
  const sanitized = sanitizeJson(value);
  return isJsonObject(sanitized) ? sanitized : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonObject(value: RuntimeJsonValue): value is RuntimeJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutUndefinedInterrupt(value: RuntimeInterrupt): RuntimeInterrupt {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as RuntimeInterrupt;
}

function withoutUndefinedResumeDecision(value: RuntimeResumeDecision): RuntimeResumeDecision {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as RuntimeResumeDecision;
}
