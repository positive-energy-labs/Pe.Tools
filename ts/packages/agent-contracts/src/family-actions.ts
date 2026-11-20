import type { Command } from "./command.ts";
import { z } from "zod";
import { specDocSchema } from "./family.ts";
import { documentRefSchema } from "./target.ts";
import { nativeProcessSchema } from "./native-process.ts";
import { workKeySchema } from "./route-state.ts";
import { workHandleSchema } from "./command.ts";
import { podDraftSourceSchema, podMemberSchema, podMemberSourceSchema } from "./settings.ts";
import {
  familiesObservationSummarySchema,
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
/**
 * The capture writer and saved spec asset reader share the Pod folder.
 */
export const FAMILY_MEMBER_DIR = "settings/family/";
export const familyMemberPath = (name: string) => `${FAMILY_MEMBER_DIR}${name}.json`;
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
  "families.read": {
    catalogEffect: "SessionWrite",
    native: ["revit.matrix.loaded-families"],
    says: "Audit the selected Families Work scope in the exact document, then bind its completed observation at the reviewed Work revision.",
    dirties: ["families"],
    needs: "project-document",
    effect: "command",
    input: z.strictObject({ work: workHandleSchema, readId: z.uuid() }),
    // The summary, not the matrix: a receipt is one reading frame (gate-ef940d36: 2.95 MB against 2 MiB).
    // The bound matrix is read through route:families.view.
    result: familiesObservationSummarySchema,
  },
  "families.cancel-read": {
    catalogEffect: "SessionWrite",
    native: ["op.cancel"],
    says: "Cancel this exact running Families read in the selected document.",
    dirties: [],
    needs: "project-document",
    effect: "command",
    input: z.strictObject({ readId: z.uuid() }),
    result: z.strictObject({ cancelled: z.literal(true) }),
  },
  "settings.observe": {
    catalogEffect: "SessionWrite",
    autoAdopt: true,
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
    catalogEffect: "SessionWrite",
    says: "Save the reviewed Work to its source member, or create a new member at an explicit destination.",
    needs: "nothing",
    effect: "command",
    dirties: ["pods"],
    input: z.strictObject({ destination: podMemberSchema.optional() }),
  },
  "families.capture": {
    catalogEffect: "SessionWrite",
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
    catalogEffect: "SessionWrite",
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
} as const;
export const familyReadingRoute = "family.readings";
export const savedFamilyRead = "family.saved";
export const familyReads = {
  [savedFamilyRead]: {
    via: { route: "family.readings" },
    catalogEffect: "Read",
    says: "Read an immutable saved Family reading, including historical citation IDs, without Revit.",
    dirties: [],
    needs: "nothing",
    effect: "query",
    input: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }),
  },
  "parameter-links.read": {
    via: { route: "family.readings" },
    catalogEffect: "Read",
    says: "Read the stored parameter-link profile and runtime status, and optionally evaluate the authored draft, into a durable reading; writes nothing.",
    dirties: [],
    needs: "project-document",
    effect: "query",
    input: z.object({
      evaluate: z.boolean().default(false),
    }),
  },
} as const satisfies Record<string, Command>;
export type FamilyActionKey = keyof typeof familyActions;
export type FamilyReadKey = keyof typeof familyReads;
