import { basisSchema, callerSchema } from "./caller.ts";
import { z } from "zod";
import { workKeySchema } from "./route-state.ts";
import { footprintSchema } from "./run-registry.ts";
import { executionTargetSchema, type ExecutionTarget } from "./target.ts";
import { consumedSchema, claimSchema, commandRefusalSchema } from "./command.ts";
import { nativeProcessSchema } from "./native-process.ts";
export { nativeProcessSchema, type NativeProcess } from "./native-process.ts";
import {
  retainedDocumentRefSchema,
  retainedOriginalTargetSchema,
  retainedWorkKeySchema,
  retainedBasisSchema,
  retainedConsumedSchema,
  retainedRefusalSchema,
  retainedFootprintSchema,
  type RetainedOriginalTarget,
  type RetainedWorkKey,
} from "./receipt-evidence.ts";
export {
  retainedDocumentRefSchema,
  type RetainedDocumentRef,
  retainedOriginalTargetSchema,
  type RetainedOriginalTarget,
  retainedWorkKeySchema,
  type RetainedWorkKey,
} from "./receipt-evidence.ts";

/** Observation only: an original whose public execution identity cannot be established. */
export const unavailableOriginalTargetSchema = z.strictObject({
  kind: z.literal("unavailable-original"),
  original: retainedOriginalTargetSchema,
});
export const receiptTargetSchema = z.union([
  executionTargetSchema,
  unavailableOriginalTargetSchema,
]);
export type ReceiptTarget = ExecutionTarget | z.infer<typeof unavailableOriginalTargetSchema>;
export { sameReceiptWork } from "./receipt-work.ts";
export const receiptDocumentTargetSchema = z.union([
  executionTargetSchema.options[3],
  z.strictObject({
    kind: z.literal("unavailable-original"),
    original: z.strictObject({
      kind: z.literal("document"),
      ref: retainedDocumentRefSchema,
    }),
  }),
]);
export type ReceiptDocumentTarget = z.infer<typeof receiptDocumentTargetSchema>;
/** Captures and receipts share one read projection; neither resolves a label. */
export function projectRetainedDocument(
  ref: z.infer<typeof retainedDocumentRefSchema>,
): ReceiptDocumentTarget {
  const target = { kind: "document" as const, ref };
  const fresh = executionTargetSchema.options[3].safeParse(target);
  return fresh.success ? fresh.data : { kind: "unavailable-original", original: target };
}
export function projectReceiptTarget(original: RetainedOriginalTarget): ReceiptTarget {
  if (original.kind === "document") return projectRetainedDocument(original.ref);
  const fresh = executionTargetSchema.safeParse(original);
  return fresh.success ? fresh.data : { kind: "unavailable-original", original };
}
export const receiptWorkBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("work"), key: workKeySchema }),
  z.strictObject({ kind: z.literal("unavailable-original"), original: retainedWorkKeySchema }),
]);
export type ReceiptWorkBinding = z.infer<typeof receiptWorkBindingSchema>;
export function projectRetainedWork(original: RetainedWorkKey): ReceiptWorkBinding {
  const fresh = workKeySchema.safeParse(original);
  return fresh.success
    ? { kind: "work", key: fresh.data }
    : { kind: "unavailable-original", original };
}
/** One public outcome vocabulary across host receipts, Pea and the shell Timeline. */
export const invocationOutcomeSchema = z.strictObject({
  id: z.string(),
  state: z.enum([
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
function stepStates<T extends z.ZodRawShape>(transport: T) {
  const intent = stepIntent.extend(transport);
  return z.discriminatedUnion("state", [
    intent.extend({ state: z.literal("running") }).strict(),
    intent
      .extend({
        state: z.literal("succeeded"),
        result: z.unknown().refine((value) => value !== undefined),
      })
      .strict(),
    intent
      .extend({
        state: z.literal("failed"),
        ...executionFailure,
        notDispatched: z.literal(true).optional(),
      })
      .strict(),
    intent.extend({ state: z.literal("unknown"), ...executionFailure }).strict(),
    // Cancelled is its own settled state: the op reached Revit, stopped at a checkpoint, and needs
    // no recovery read. Unknown means nobody knows; failed means the operation answered, and
    // notDispatched proves it never ran when present.
    intent
      .extend({
        state: z.literal("cancelled"),
        error: z.string(),
        status: z.number(),
        notDispatched: z.literal(true).optional(),
      })
      .strict(),
  ]);
}
/** A bridge reply or a decoded C# op receipt carries model-change evidence; dispatch transport stays immutable. */
export const actionStepSchema = z.union([
  stepStates({
    transport: z.literal("bridge"),
    touched: z.lazy(() => touchedSchema).optional(),
    nativeEvidence: z.lazy(() => observedSchema).optional(),
    bridgeReply: z.enum(["touched", "missing-touched", "invalid-touched"]).optional(),
  }),
  stepStates({
    transport: z.literal("sdk").optional(),
    opReceipt: z.lazy(() => nativeReceiptSchema),
    touched: z.lazy(() => touchedSchema),
    nativeEvidence: z.lazy(() => observedSchema).optional(),
  }),
  stepStates({ transport: z.literal("sdk").optional() }),
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
function receiptStates<T extends z.ZodRawShape>(actionAttempt: z.ZodObject<T>) {
  return z.discriminatedUnion("state", [
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
}
const retainedAttempt = actionAttempt.extend({
  snapshots: z.array(timelineSnapshotSchema.extend({ address: retainedWorkKeySchema })).optional(),
  effects: retainedFootprintSchema.default([]),
  consumes: z.array(retainedConsumedSchema).default([]),
  refusal: retainedRefusalSchema.optional(),
  basis: retainedBasisSchema.nullable(),
  target: retainedOriginalTargetSchema,
});
export const executableActionReceiptSchema = receiptStates(actionAttempt);
export type ExecutableActionReceipt = z.infer<typeof executableActionReceiptSchema>;
const persistedDefinition = receiptStates(retainedAttempt);
export type PersistedActionReceipt = z.infer<typeof persistedDefinition>;
/** Storage owns this decoder. Live identity schema changes cannot discard retained evidence. */
export const persistedActionReceiptSchema = persistedDefinition;
const actionReceiptDefinition = receiptStates(
  retainedAttempt.extend({ target: receiptTargetSchema }),
);
export type ActionReceipt = z.infer<typeof actionReceiptDefinition>;
export const actionReceiptSchema: z.ZodType<ActionReceipt> = actionReceiptDefinition.overwrite(
  (row) => ({ ...row, outcome: invocationOutcome(row) }),
);
export function projectActionReceipt(row: PersistedActionReceipt): ActionReceipt {
  return actionReceiptSchema.parse({
    ...row,
    target: projectReceiptTarget(row.target),
  });
}
/** The public unavailable case is a projection. Disk keeps the exact original target. */
export function persistActionReceipt(row: ActionReceipt): PersistedActionReceipt {
  return persistedActionReceiptSchema.parse({
    ...row,
    target: row.target.kind === "unavailable-original" ? row.target.original : row.target,
  });
}
/** The owner's decoder preserves defaults and derived outcomes that JSON Schema cannot execute. */
export function actionReceiptListDecoder(): z.ZodType<ActionReceipt[]> {
  return actionReceiptSchema.array();
}

const statusAttempt = retainedAttempt
  .extend({ target: receiptTargetSchema })
  .omit({ steps: true, prepared: true, recovery: true });
const actionStatusDefinition = z.discriminatedUnion("state", [
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

/** A view is named with its document: an op can touch more than one. */
export const viewRefSchema = z.strictObject({
  documentKey: z.string(),
  uniqueId: z.string(),
  id: z.number().int(),
});
export type ViewRef = z.infer<typeof viewRefSchema>;
const changed = {
  transactions: z.array(z.string()),
  added: z.number().int().nonnegative(),
  modified: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
};
/** What one native call did to the document. Filled by the scope and the change monitor, never by
 * an op. Omitted from what Pea reads when "none". `restoreFailed`, `unauthorized` and `unknown`
 * raise one notice at the terminal write. The C# twin is `Touched` in Pe.Shared.HostContracts
 * `Bridge/Touched.cs`; both assert `tests/fixtures/receipt-response.fixture.json`. */
export const touchedSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("rolledBack") }),
  z.strictObject({ kind: z.literal("restored"), views: z.array(viewRefSchema) }),
  z.strictObject({
    kind: z.literal("restoreFailed"),
    views: z
      .array(
        z.strictObject({
          view: viewRefSchema,
          left: z.array(
            z.enum(["crop", "scopeBox", "annotationCrop", "sheetFilter", "phase", "phaseFilter"]),
          ),
        }),
      )
      .min(1),
  }),
  z.strictObject({ kind: z.literal("wrote"), ...changed }),
  z.strictObject({ kind: z.literal("unauthorized"), ...changed }),
  z.strictObject({
    kind: z.literal("unknown"),
    reason: z.enum([
      "lost-response",
      "cancelled-mid-effect",
      "process-exit",
      "posted-command",
      "overlapped",
    ]),
  }),
]);
export type Touched = z.infer<typeof touchedSchema>;
/** The least every evidence record states (C# `IObserved`). A null or absent revision is no
 * source-revision proof: the observed basis is unavailable, never 0 or "current". The domain's own
 * members (Space's sources and manifest) ride beside these two and are kept. */
export const observedSchema = z.looseObject({
  documentKey: z.string(),
  revision: z.number().int().nullish(),
});
export type Observed = z.infer<typeof observedSchema>;
/** The one object a C# op writes to its receipt's response file (`OpReceiptResponse`),
 * which `pe-revit op result` returns as `response`. A success has `payload` and no `error`; a
 * failure has `error` and no `payload`. Both carry `touched`: a failed or cancelled call may still
 * have written. `evidence` is absent when the op's response type declares none. The verdict is on
 * the SDK receipt, not here. */
export const nativeReceiptResponseSchema = z.union([
  z.strictObject({
    payload: z.unknown().refine((value) => value !== undefined, "Success requires a payload key"),
    touched: touchedSchema.refine(
      (value) => value.kind !== "unauthorized",
      "Unauthorized changes cannot succeed",
    ),
    evidence: observedSchema.optional(),
  }),
  z.strictObject({ ...nativeReceiptFailureSchema.shape, touched: touchedSchema }),
]);
export type NativeReceiptResponse = z.infer<typeof nativeReceiptResponseSchema>;

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
        : row.state === "failed" && row.notDispatched
          ? "refused"
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
      : state === "refused" &&
          row.state === "failed" &&
          row.notDispatched &&
          row.refusal?.kind !== "invalid" &&
          row.refusal?.kind !== "held" &&
          row.refusal?.kind !== "claimed"
        ? { recovery: "retry" as const }
        : {}),
  };
}
