import type { Command } from "./command.ts";
import { z } from "zod";
import { specDocSchema } from "./family.ts";
import { documentRefSchema } from "./target.ts";
import { nativeProcessSchema } from "./native-process.ts";
import { workKeySchema } from "./route-state.ts";
import { podDraftSourceSchema, podMemberSchema, podMemberSourceSchema } from "./settings.ts";
import {
  diagnosticSchema,
  familyExecutionOptionsSchema,
  ffPlanEntrySchema,
  ffReceiptSchema,
  type FfPlanEntry,
} from "./families.ts";
import { parameterLinksReadingSchema } from "./parameter-links.ts";
import { workPathSchema } from "./command.ts";

/** Native evidence is preserved; semantic callers consume the command result, never its steps. */
export const familyNativeApplyResultSchema = z.looseObject({
  receipts: z.array(ffReceiptSchema.loose()),
  diagnostics: z.array(diagnosticSchema.loose()),
  receiptPath: z.string().nullish(),
  reason: z.string().nullish(),
});
const familyApplyOutcomeSchema = z.object({
  executionContext: documentRefSchema,
  native: familyNativeApplyResultSchema,
  retired: z
    .object({ retired: z.array(workPathSchema), revision: z.number().int().nonnegative() })
    .optional(),
  readback: z.object({ id: z.string() }).optional(),
  readbackError: z.string().optional(),
});
type FamilyApplyOutcome = z.infer<typeof familyApplyOutcomeSchema>;
export type FamilyApplyResult = FamilyApplyOutcome | { results: FamilyApplyOutcome[] };
export const familyApplyResultSchema: z.ZodType<FamilyApplyResult> = z.union([
  familyApplyOutcomeSchema,
  z.object({ results: z.array(familyApplyOutcomeSchema) }),
]);
export interface FamilyPlanResult {
  id: string;
  executionContext: z.infer<typeof documentRefSchema>;
  plan: FfPlanEntry | FfPlanEntry[];
  included: Record<string, string>;
  excluded?: unknown[];
  orphaned?: string[];
  [key: string]: unknown;
}
export const familyPlanResultSchema: z.ZodType<FamilyPlanResult> = z.looseObject({
  id: z.string(),
  executionContext: documentRefSchema,
  plan: z.union([ffPlanEntrySchema, z.array(ffPlanEntrySchema)]),
  included: z.record(z.string(), z.string()),
  excluded: z.array(z.unknown()).optional(),
  orphaned: z.array(z.string()).optional(),
});

export const familyCaptureSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  key: workKeySchema,
  capturedAt: z.string(),
  provenance: z.discriminatedUnion("kind", [
    // Historical readings remain inspectable; mutation requires a captured native process.
    z.object({
      kind: z.literal("live"),
      target: documentRefSchema,
      process: nativeProcessSchema.optional(),
    }),
    z.object({ kind: z.literal("file") }),
  ]),
  reading: z.discriminatedUnion("kind", [
    // Route readings live beside Family's, in the same owner, under the route's own WorkKey.
    z.object({ kind: z.literal("parameter-links"), value: parameterLinksReadingSchema }),
    z.object({
      kind: z.literal("spec"),
      value: specDocSchema,
    }),
  ]),
});
export type FamilyCapture = z.infer<typeof familyCaptureSchema>;
export const familyLiveReadSchema = z.object({
  reading: z.string(),
  takenAt: z.iso.datetime(),
  executionContext: documentRefSchema,
  process: nativeProcessSchema,
});
/** Where a capture lands: the route's current pod, and a new member path the host may choose. */
const captureInto = { pod: z.string().min(1), path: z.string().min(1).optional() };
/**
 * What a plan consumes: a saved member, or a draft's bytes; the run apply files captures either
 * exactly. Strict arms: a shape with both `sha256` and `content` refuses instead of losing one to
 * stripping.
 */
const planSourceSchema = z.union([podMemberSourceSchema.strict(), podDraftSourceSchema.strict()]);
const applySourceSchema = z.strictObject({
  source: planSourceSchema,
  familyNames: z.array(z.string()).optional(),
  executionOptions: familyExecutionOptionsSchema.optional(),
});
const applyInputSchema = z
  .object({
    source: planSourceSchema.optional(),
    sources: z.array(applySourceSchema).min(1).optional(),
    include: z.union([z.literal("all"), z.array(z.string()).min(1)]).default("all"),
    plan: z.string().min(1).optional(),
    familyNames: z.array(z.string()).optional(),
    executionOptions: familyExecutionOptionsSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      [input.source, input.sources, input.plan].filter((value) => value !== undefined).length <= 1,
    "Choose one source, source batch, preview, or the reviewed Work",
  );
export const familyActions = {
  "family.attach-spec": {
    says: "Attach a PDF specification and its parsed assets to the reviewed family member.",
    needs: "nothing",
    effect: "command",
    dirties: ["pods"],
    input: z.object({
      member: podMemberSchema,
      source: z.union([
        z.strictObject({ path: z.string().min(1) }),
        z.strictObject({ url: z.url() }),
        z.strictObject({ fileName: z.string().min(1), base64: z.string().min(1) }),
      ]),
    }),
    result: z.object({
      member: podMemberSchema,
      specPath: z.string(),
      pages: z.number(),
      blocks: z.number(),
      images: z.number(),
    }),
  },
  "family.observe": {
    says: "Adopt a verified capture receipt or exact saved source as the Family Work baseline; edits stay editable.",
    needs: "family-document",
    effect: "query",
    dirties: [],
    input: z
      .object({
        readingId: z.string().min(1).optional(),
        source: podMemberSourceSchema.optional(),
      })
      .refine((input) => (input.readingId !== undefined) !== (input.source !== undefined), {
        message: "Provide exactly one capture receipt or saved source",
      }),
  },
  "settings.observe": {
    says: "Adopt verified saved member bytes as the shared Work baseline; replacing pending edits requires explicit intent.",
    needs: "nothing",
    effect: "command",
    dirties: [],
    input: z.object({
      member: podMemberSchema,
      sha256: z.string().optional(),
      replaceEdits: z.boolean().default(false),
    }),
  },
  "settings.write": {
    says: "Save the reviewed Work to its source member, or create a new member at an explicit destination.",
    needs: "nothing",
    effect: "command",
    dirties: ["pods"],
    input: z.strictObject({ destination: podMemberSchema.optional() }),
  },
  "family.capture": {
    says: "Read the open family's spec. With a pod, file it as a new member there (the draft's `spec` text when given, else what Revit said) and write the run; without one, return the spec and write nothing.",
    needs: "family-document",
    effect: "command",
    dirties: ["pods"],
    input: z
      .object({ ...captureInto, pod: captureInto.pod.optional(), spec: z.string().optional() })
      .refine((input) => input.pod || (!input.spec && !input.path), "A draft saves into a pod"),
  },
  "family.plan": {
    says: "Preview the reviewed Family Work or an exact saved or supplied source against the open family. Seal the source and return the plan; change nothing.",
    needs: "family-document",
    effect: "query",
    dirties: [],
    input: z.object({ source: planSourceSchema.optional() }),
    result: familyPlanResultSchema,
  },
  "family.apply": {
    says: "Plan and apply the reviewed Family Work, or apply an optional preview's sealed intent, and write a run receipt. Retire successful consumed edits only while unchanged.",
    needs: "family-document",
    effect: "command",
    dirties: ["family", "pods"],
    input: applyInputSchema,
    result: familyApplyResultSchema,
  },
  "families.capture": {
    says: "Capture loaded families as new spec members in the route's pod, one member per family; returns the members and what the capture saw per family.",
    needs: "project-document",
    effect: "command",
    dirties: ["pods"],
    input: z.object({ pod: z.string().min(1), familyIds: z.array(z.number().int()).min(1) }),
  },
  "families.plan": {
    says: "Preview all reviewed Families drafts or an exact supplied source within the reviewed scope. Seal the sources and return their plans; change nothing.",
    needs: "project-document",
    effect: "query",
    dirties: [],
    input: z
      .object({
        source: planSourceSchema.optional(),
        /**
         * Plan only these families of the scope, by NAME (a generated one-family member); absent =
         * the scope. The library resolves each name against the open document at plan.
         */
        familyNames: z.array(z.string().min(1)).nonempty().optional(),
        executionOptions: familyExecutionOptionsSchema.optional(),
      })
      // Exclusions are read from the reviewed Work, never sent; a stale caller sending them refuses.
      .strict(),
    result: familyPlanResultSchema,
  },
  "families.apply": {
    says: "Plan and apply all reviewed Families drafts in one command, or apply an optional preview's sealed intent. Preserve per-family outcomes and retire only successful unchanged consumed edits.",
    needs: "project-document",
    effect: "command",
    dirties: ["families", "pods"],
    input: applyInputSchema,
    result: familyApplyResultSchema,
  },
  "families.save-draft": {
    says: "Compose the edited family drafts from reviewed Work and save each as a new Pod member.",
    needs: "nothing",
    effect: "command",
    dirties: ["pods"],
    input: z.object({ pod: z.string().min(1) }),
    result: z.object({
      saved: z.number().int().nonnegative(),
      members: z.array(podMemberSourceSchema),
    }),
  },
  "parameter-links.apply": {
    native: ["revit.apply.parameter-links"],
    says: "Store the reviewed parameter-link draft and reconcile exactly the evaluated writes the human approved.",
    needs: "project-document",
    effect: "command",
    dirties: ["parameter-links"],
    input: z.object({
      readingId: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    }),
  },
  "family.build": {
    says: "Build a saved composed family spec into its source Pod's run folder. The target is execution context for the new family.",
    needs: "document",
    effect: "command",
    dirties: ["family"],
    input: z.object({
      source: podMemberSourceSchema,
      modelDirectory: z.string().optional(),
    }),
  },
} as const;
export const familyReads = {
  "family.read": {
    says: "Read the open family's spec into the draft baseline; preserve staged cells and proposals and file no Pod member.",
    dirties: [],
    needs: "family-document",
    effect: "query",
    input: z.strictObject({ readId: z.uuid(), expectedRevision: z.number().int().nonnegative() }),
    result: familyLiveReadSchema,
  },
  "family.cancel-read": {
    says: "Cancel this exact running Family read.",
    dirties: [],
    needs: "family-document",
    effect: "query",
    input: z.strictObject({ readId: z.uuid() }),
    result: z.object({ cancelled: z.literal(true) }),
  },
  "family.saved": {
    says: "Read an immutable saved Family reading, including historical citation IDs, without Revit.",
    dirties: [],
    needs: "nothing",
    effect: "query",
    input: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }),
  },
  "parameter-links.read": {
    says: "Read the stored parameter-link profile and runtime status, and optionally evaluate the authored draft, into a durable reading; writes nothing.",
    dirties: [],
    needs: "project-document",
    effect: "query",
    input: z.object({
      evaluate: z.boolean().default(false),
      /** A proposal evaluation is a labelled preview; only the staged profile can arm apply. */
      subject: z.enum(["edit", "suggestion"]).default("edit"),
    }),
  },
} as const satisfies Record<string, Command>;
export type FamilyActionKey = keyof typeof familyActions;
export type FamilyReadKey = keyof typeof familyReads;
