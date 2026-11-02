import { basisSchema, callerSchema } from "./caller.ts";
import { z } from "zod";
import { workKeySchema } from "./route-state.ts";
import { footprintSchema, commandConsentSchema } from "./run-consent.ts";
import { executionTargetSchema } from "./target.ts";
import { consumedSchema, claimSchema, commandRefusalSchema } from "./command.ts";
import { nativeProcessSchema } from "./native-process.ts";
export { nativeProcessSchema, type NativeProcess } from "./native-process.ts";

/** One public outcome vocabulary across host receipts, Pea and the shell Timeline. */
export const invocationOutcomeSchema = z.strictObject({
  id: z.string(),
  state: z.enum([
    "queued",
    "running",
    "refused",
    "stale",
    "cancelled",
    "succeeded",
    "failed",
    "outcome-unknown",
  ]),
  input: z.unknown(),
  reason: z.string().optional(),
  recovery: z.enum(["retry", "reconcile", "resume"]).optional(),
  receiptId: z.string().optional(),
  consentWindow: z
    .strictObject({ requestId: z.string(), deadline: z.string().optional() })
    .optional(),
  snapshots: z.array(z.string()).optional(),
});
export type InvocationOutcome = z.infer<typeof invocationOutcomeSchema>;

const stepIntent = z.object({
  id: z.string(),
  key: z.string(),
  kind: z.enum(["native", "file", "publication"]),
  input: z.unknown(),
  process: nativeProcessSchema.optional(),
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
/** Host-filed receipt checkpoint. TODO: docs/features/routes/LEDGER.md#s7-b8dae54505 resolve these references in the owed ?at= viewer. */
export const timelineSnapshotSchema = z.strictObject({
  id: z.string(),
  address: workKeySchema,
  workRevision: z.number().int().nonnegative(),
  readingHashes: z.record(z.string(), z.string()),
});
export type TimelineSnapshot = z.infer<typeof timelineSnapshotSchema>;

const actionAttempt = z.object({
  snapshots: z.array(timelineSnapshotSchema).optional(),
  id: z.string().min(1),
  key: z.string(),
  outcome: invocationOutcomeSchema.optional(),
  /** Host-minted; never read from the admission body. */
  caller: callerSchema,
  effects: footprintSchema.default([]),
  consumes: z.array(consumedSchema).default([]),
  claims: z.array(claimSchema).default([]),
  refusal: commandRefusalSchema.optional(),
  consent: commandConsentSchema.nullable().default(null),
  cancellationRequested: z.boolean().optional(),
  consentWindow: z
    .strictObject({ requestId: z.string(), deadline: z.string().optional() })
    .optional(),
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
export const actionReceiptSchema: z.ZodType<ActionReceipt> = actionReceiptDefinition.overwrite(
  (row) => ({ ...row, outcome: invocationOutcome(row) }),
);
/** The owner's decoder preserves defaults and derived outcomes that JSON Schema cannot execute. */
export function actionReceiptListDecoder(): z.ZodType<ActionReceipt[]> {
  return actionReceiptSchema.array();
}

const statusAttempt = actionAttempt.omit({ steps: true, prepared: true, recovery: true });
const actionStatusDefinition = z.discriminatedUnion("state", [
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
export type ActionStatus = z.infer<typeof actionStatusDefinition>;
export const actionStatusSchema: z.ZodType<ActionStatus> = actionStatusDefinition.overwrite(
  (row) => ({ ...row, outcome: invocationOutcome(row) }),
);

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

/** A projection of the durable receipt, never a second writable outcome. */
export function invocationOutcome(row: ActionReceipt | ActionStatus): InvocationOutcome {
  const reason = "error" in row ? row.error : undefined;
  const state: InvocationOutcome["state"] =
    row.state === "unknown" || row.state === "incomplete"
      ? "outcome-unknown"
      : row.refusal
        ? row.refusal.kind === "stale" || row.refusal.kind === "stale_revision"
          ? "stale"
          : "refused"
        : row.state === "waiting"
          ? "queued"
          : row.state;
  return {
    id: row.id,
    state,
    input: row.input,
    receiptId: row.id,
    ...(reason ? { reason } : {}),
    snapshots: row.snapshots?.map((snapshot) => snapshot.id) ?? [],
    ...(state === "outcome-unknown"
      ? { recovery: row.state === "incomplete" ? ("resume" as const) : ("reconcile" as const) }
      : state === "failed" && "notDispatched" in row && row.notDispatched
        ? { recovery: "retry" as const }
        : {}),
    ...(row.consentWindow ? { consentWindow: row.consentWindow } : {}),
  };
}
