import { documentRefSchema } from "./target.ts";
import { z } from "zod";
import { executionTargetSchema } from "./target.ts";

const stepIntent = z.object({
  id: z.string(),
  key: z.string(),
  kind: z.enum(["native", "file", "publication"]),
  input: z.unknown(),
});
const executionFailure = {
  evidence: z.object({ result: z.unknown() }).strict().optional(),
  error: z.string(),
  status: z.number(),
  nativeOutcome: z.string().optional(),
  issues: z
    .array(
      z.object({
        instancePath: z.string(),
        code: z.string(),
        message: z.string(),
        severity: z.string(),
        schemaPath: z.string().nullable().optional(),
        suggestion: z.string().nullable().optional(),
      }),
    )
    .optional(),
};
export const actionStepSchema = z.discriminatedUnion("state", [
  stepIntent.extend({ state: z.literal("running") }).strict(),
  stepIntent
    .extend({
      state: z.literal("succeeded"),
      result: z.unknown().refine((value) => value !== undefined),
    })
    .strict(),
  stepIntent
    .extend({
      state: z.literal("failed"),
      ...executionFailure,
      notDispatched: z.literal(true).optional(),
    })
    .strict(),
  stepIntent.extend({ state: z.literal("unknown"), ...executionFailure }).strict(),
  // Cancelled is its own settled state: the op reached Revit, stopped at a checkpoint, and needs
  // no recovery read. Unknown means nobody knows; failed means the operation answered, and
  // notDispatched proves it never ran when present.
  stepIntent
    .extend({ state: z.literal("cancelled"), error: z.string(), status: z.number() })
    .strict(),
]);
export type ActionStep = z.infer<typeof actionStepSchema>;
const actionAttempt = z.object({
  kind: z.enum(["operation", "workflow"]),
  id: z.string().min(1),
  key: z.string(),
  actor: z.enum(["human", "agent"]),
  destination: executionTargetSchema,
  request: z.record(z.string(), z.unknown()),
  bases: z.record(z.string(), z.unknown()),
  steps: z.array(actionStepSchema),
  preparation: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unprepared") }),
    z.strictObject({ state: z.literal("ready"), value: z.unknown() }),
  ]),
  recovery: z.array(z.strictObject({ stepId: z.string(), at: z.string(), evidence: z.unknown() })),
  startedAt: z.string(),
  publication: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unrequested") }),
    z.strictObject({ state: z.literal("recorded"), result: z.unknown() }),
  ]),
});
export const actionReceiptSchema = z.discriminatedUnion("state", [
  actionAttempt.extend({ state: z.literal("running") }).strict(),
  actionAttempt
    .extend({ state: z.literal("succeeded"), result: z.unknown().refine((v) => v !== undefined) })
    .strict(),
  actionAttempt
    .extend({
      state: z.literal("failed"),
      ...executionFailure,
      notDispatched: z.literal(true).optional(),
    })
    .strict(),
  actionAttempt.extend({ state: z.literal("unknown"), ...executionFailure }).strict(),
  actionAttempt
    .extend({
      state: z.literal("incomplete"),
      error: z.string(),
      status: z.number(),
      result: z.unknown(),
    })
    .strict(),
  actionAttempt
    .extend({ state: z.literal("cancelled"), error: z.string(), status: z.number() })
    .strict(),
]);
export const actionStatusSchema = z.discriminatedUnion("state", [
  actionAttempt
    .omit({ steps: true, preparation: true, recovery: true })
    .extend({ state: z.literal("running") }),
  actionAttempt
    .omit({ steps: true, preparation: true, recovery: true })
    .extend({ state: z.literal("succeeded") }),
  actionAttempt.omit({ steps: true, preparation: true, recovery: true }).extend({
    state: z.literal("failed"),
    ...executionFailure,
    notDispatched: z.literal(true).optional(),
  }),
  actionAttempt
    .omit({ steps: true, preparation: true, recovery: true })
    .extend({ state: z.literal("unknown"), ...executionFailure }),
  actionAttempt
    .omit({ steps: true, preparation: true, recovery: true })
    .extend({ state: z.literal("incomplete"), error: z.string(), status: z.number() }),
  actionAttempt
    .omit({ steps: true, preparation: true, recovery: true })
    .extend({ state: z.literal("cancelled"), error: z.string(), status: z.number() }),
]);
export type ActionReceipt = z.infer<typeof actionReceiptSchema>;
export type ActionStatus = z.infer<typeof actionStatusSchema>;

export const nativeProcessSchema = z.strictObject({
  pid: z.number().int().positive(),
  processStartUtc: z.string().min(1),
  executable: z.string().min(1),
});
export type NativeProcess = z.infer<typeof nativeProcessSchema>;

export const nativeReceiptSchema = z.object({
  requestId: z.string(),
  key: z.string(),
  pid: z.number().int(),
  processStartUtc: z.string(),
  verdict: z.string(),
});
export const nativeReceiptFailureSchema = z.object({
  error: z.string(),
  statusCode: z.number(),
  outcome: z.string().optional(),
});

/** Receipt discovery is a selected subject, never an inferred active document or all-history view. */
export const actionListFilterSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("instances"), workspaceId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("schedules"), workspaceId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("family-file"), workspaceId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("file"), workspaceId: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("family"),
    workspaceId: z.string().min(1),
    target: documentRefSchema,
  }),
]);
export type ActionListFilter = z.infer<typeof actionListFilterSchema>;
