import { basisSchema, callerSchema } from "./caller.ts";
import { z } from "zod";
import { footprintSchema, commandConsentSchema } from "./run-consent.ts";
import { executionTargetSchema } from "./target.ts";
import { consumedSchema, claimSchema, commandRefusalSchema } from "./command.ts";
import { nativeProcessSchema } from "./native-process.ts";
export { nativeProcessSchema, type NativeProcess } from "./native-process.ts";

const stepIntent = z.object({
  id: z.string(),
  key: z.string(),
  kind: z.enum(["native", "file", "publication"]),
  input: z.unknown(),
  process: nativeProcessSchema.optional(),
  established: z.array(consumedSchema).optional(),
  releases: z.array(z.strictObject({ action: z.string(), claim: claimSchema })).optional(),
  retired: z.literal(true).optional(),
  dispatchedAt: z.string().optional(),
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
    .extend({
      state: z.literal("cancelled"),
      error: z.string(),
      status: z.number(),
      notDispatched: z.literal(true).optional(),
    })
    .strict(),
]);
export type ActionStep = z.infer<typeof actionStepSchema>;
const actionAttempt = z.object({
  id: z.string().min(1),
  key: z.string(),
  /** Host-minted; never read from the admission body. */
  caller: callerSchema,
  effects: footprintSchema.default([]),
  consumes: z.array(consumedSchema).default([]),
  claims: z.array(claimSchema).default([]),
  refusal: commandRefusalSchema.optional(),
  consent: commandConsentSchema.nullable().default(null),
  cancellationRequested: z.boolean().optional(),
  /** Why the crossing was admitted; null for a host leaf that crosses into no Revit document. */
  basis: basisSchema.nullable(),
  target: executionTargetSchema,
  input: z.record(z.string(), z.unknown()),
  steps: z.array(actionStepSchema),
  prepared: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unprepared") }),
    z.strictObject({ state: z.literal("ready"), value: z.unknown() }),
  ]),
  recovery: z.array(z.strictObject({ stepId: z.string(), at: z.string(), evidence: z.unknown() })),
  startedAt: z.string(),
});
const actionReceiptDefinition = z.discriminatedUnion("state", [
  actionAttempt.extend({ state: z.literal("waiting") }).strict(),
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
    .extend({
      state: z.literal("cancelled"),
      error: z.string(),
      status: z.number(),
      notDispatched: z.literal(true).optional(),
    })
    .strict(),
]);
export type ActionReceipt = z.infer<typeof actionReceiptDefinition>;
export const actionReceiptSchema: z.ZodType<ActionReceipt> = actionReceiptDefinition;
const statusAttempt = actionAttempt.omit({ steps: true, prepared: true, recovery: true });
export const actionStatusSchema = z.discriminatedUnion("state", [
  statusAttempt.extend({ state: z.literal("waiting") }),
  statusAttempt.extend({ state: z.literal("running") }),
  statusAttempt.extend({ state: z.literal("succeeded") }),
  statusAttempt.extend({
    state: z.literal("failed"),
    ...executionFailure,
    notDispatched: z.literal(true).optional(),
  }),
  statusAttempt.extend({ state: z.literal("unknown"), ...executionFailure }),
  statusAttempt.extend({ state: z.literal("incomplete"), error: z.string(), status: z.number() }),
  statusAttempt.extend({
    state: z.literal("cancelled"),
    error: z.string(),
    status: z.number(),
    notDispatched: z.literal(true).optional(),
  }),
]);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

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
