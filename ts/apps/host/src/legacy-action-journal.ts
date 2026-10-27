/** Pinned foundation-v5 action reader (fd530c41). It never validates new execution or resumes it. */
import { z } from "zod";

// Historical envelopes retain their complete original JSON in the immutable archived journal.
const callerSchema = z.object({ kind: z.string() }).passthrough();
const basisSchema = z.object({ kind: z.string() }).passthrough();
const originSchema = z
  .object({ caller: callerSchema, run: z.unknown(), root: z.unknown() })
  .passthrough();
const footprintSchema = z.array(z.object({ kind: z.string() }).passthrough());
const commandConsentSchema = z.union([
  z.object({ by: z.literal("press") }).strict(),
  z.object({ run: z.unknown(), decision: z.unknown() }).strict(),
]);
const executionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("host") }).strict(),
  z
    .object({ kind: z.literal("sdk-session"), selection: z.record(z.string(), z.unknown()) })
    .strict(),
  z.object({ kind: z.literal("session"), session: z.string() }).strict(),
  z
    .object({
      kind: z.literal("document"),
      ref: z.object({ session: z.string(), openId: z.string() }).strict(),
    })
    .strict(),
]);
const stepIntent = z.object({
  id: z.string(),
  key: z.string(),
  kind: z.enum(["native", "file", "publication"]),
  input: z.unknown(),
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
const actionStepSchema = z.discriminatedUnion("state", [
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
const actionAttempt = z.object({
  kind: z.enum(["operation", "workflow"]),
  id: z.string().min(1),
  key: z.string(),
  /** Host-minted; never read from the admission body. */
  caller: callerSchema,
  origin: originSchema.optional(),
  footprint: footprintSchema.default([]),
  consent: commandConsentSchema.nullable().default(null),
  frozen: z.unknown().optional(),
  cancellationRequested: z.boolean().optional(),
  /** Why the crossing was admitted; null for a host leaf that crosses into no Revit document. */
  basis: basisSchema.nullable(),
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
const historicalActionSchema = z.discriminatedUnion("state", [
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
    .extend({ state: z.literal("cancelled"), error: z.string(), status: z.number() })
    .strict(),
]);

/** Convert inspection facts, not execution authority. Original bytes and schema remain inspectable. */
export function importHistoricalAction(raw: unknown, archive: string, sha256: string): unknown {
  const old = historicalActionSchema.parse(raw);
  const {
    kind: _kind,
    origin: _origin,
    footprint,
    frozen: _frozen,
    destination,
    request,
    bases: _bases,
    preparation,
    publication: _publication,
    ...facts
  } = old;
  const active = old.state === "waiting" || old.state === "running";
  return {
    ...facts,
    ...(active
      ? {
          state: "unknown",
          error:
            "Historical execution requires inspection of its original journal; it cannot resume under the new command schema",
          status: 503,
        }
      : {}),
    caller: old.caller,
    basis: old.basis,
    target: destination,
    input: request,
    effects: footprint.filter((effect) => effect.kind !== "receipt"),
    consumes: [],
    claims: [],
    prepared: preparation,
    refusal: {
      kind: "domain",
      code: "historical-schema",
      message:
        "Original command facts are preserved; this historical schema cannot authorize new execution",
    },
    steps: old.steps.map((step) =>
      step.state === "running"
        ? {
            ...step,
            state: "unknown",
            error: "Historical execution has no durable outcome",
            status: 503,
          }
        : step,
    ),
    recovery: [
      ...old.recovery,
      {
        stepId: "historical-v5",
        at: old.startedAt,
        evidence: { schema: "foundation-v5", archive, sha256, action: old.id },
      },
    ],
  };
}
