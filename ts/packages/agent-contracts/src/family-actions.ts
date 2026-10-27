import type { ActionDefinition } from "./semantic-actions.ts";
import { z } from "zod";
import { specDocSchema } from "./family.ts";
import { documentRefSchema } from "./target.ts";
import { workKeySchema } from "./route-state.ts";
import { podDraftSourceSchema, podMemberSchema, podMemberSourceSchema } from "./settings.ts";
import { familyExecutionOptionsSchema } from "./families.ts";
import { parameterLinksReadingSchema } from "./parameter-links.ts";

export const familyCaptureSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  key: workKeySchema,
  capturedAt: z.string(),
  provenance: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("live"), target: documentRefSchema }),
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
/** Where a capture lands: the route's current pod, and a new member path the host may choose. */
const captureInto = { pod: z.string().min(1), path: z.string().min(1).optional() };
/**
 * What a plan consumes: a saved member, or a draft's bytes; the run apply files captures either
 * exactly. Strict arms: a shape with both `sha256` and `content` refuses instead of losing one to
 * stripping.
 */
const planSourceSchema = z.union([podMemberSourceSchema.strict(), podDraftSourceSchema.strict()]);
const sourceRowsSchema = z.object({ source: planSourceSchema, include: z.union([z.literal("all"), z.array(z.string()).min(1)]).default("all"), familyNames: z.array(z.string()).optional(), executionOptions: familyExecutionOptionsSchema.optional() }).strict();
const previewRowsSchema = z.object({ plan: z.string().min(1), expectedPlanHashes: z.record(z.string(), z.string().min(1)) }).strict();
const applyRowsSchema = z.union([sourceRowsSchema, previewRowsSchema, z.object({ sources: z.array(sourceRowsSchema.omit({include:true})).min(1), include: z.union([z.literal("all"), z.array(z.string()).min(1)]).default("all") }).strict()]);
const applyInputSchema = z.object({ rows: applyRowsSchema, familyNames: z.array(z.string()).optional(), executionOptions: familyExecutionOptionsSchema.optional() }).strict();
export const familyActions = {
  "family.observe": {
    says: "Adopt a verified capture receipt or exact saved source as the Family Work baseline; edits stay editable.",
    needs: "family-document", effect: "query", dirties: [],
    input: z.union([z.object({readingId:z.string().min(1)}),z.object({source:podMemberSourceSchema})]),
  },
  "settings.observe": {
    says: "Adopt verified saved member bytes as the shared Work baseline; replacing pending edits requires explicit intent.",
    needs:"nothing",effect:"command",dirties:[],
    input:z.object({member:podMemberSchema,sha256:z.string().optional(),replaceEdits:z.boolean().default(false)}),
  },
  "settings.write": {
    says: "Save reviewed member Work, or create exact raw bytes, through the host pod member writer.",
    needs: "nothing",
    effect: "command",
    dirties: ["pods"],
    input: z.object({
      member: podMemberSchema,
      write: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("save"), sha256: z.string().min(1) }),
        z.object({ kind: z.literal("create"), rawContent: z.string() }),
      ]),
    }),
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
    says: "Plan a saved family spec, or a supplied draft's exact bytes (filed nowhere), against the open family and return the plan; changes nothing.",
    needs: "family-document",
    effect: "query",
    dirties: [],
    input: z.object({ source: planSourceSchema }),
  },
  "family.apply": {
    says: "Apply the exact family plan a succeeded family.plan action returned (named by that action id, one included hash), from the spec bytes that plan sealed, and write a run receipt. Staged cells the plan consumed retire only if unchanged after native success.",
    needs: "family-document",
    effect: "command",
    dirties: ["family", "pods"],
    input: applyInputSchema,
  },
  "families.capture": {
    says: "Capture loaded families as new spec members in the route's pod, one member per family; returns the members and what the capture saw per family.",
    needs: "project-document",
    effect: "command",
    dirties: ["pods"],
    input: z.object({ pod: z.string().min(1), familyIds: z.array(z.number().int()).min(1) }),
  },
  "families.plan": {
    says: "Plan a saved spec, or a supplied draft's exact bytes (filed nowhere), over the loaded families in the reviewed Families Work scope; returns the plan and the hashes apply would send, and changes nothing.",
    needs: "project-document",
    effect: "query",
    dirties: [],
    input: z
      .object({
        source: planSourceSchema,
        /**
         * Plan only these families of the scope, by NAME (a generated one-family member); absent =
         * the scope. The library resolves each name against the open document at plan.
         */
        familyNames: z.array(z.string().min(1)).nonempty().optional(),
        executionOptions: familyExecutionOptionsSchema.optional(),
      })
      // Exclusions are read from the reviewed Work, never sent; a stale caller sending them refuses.
      .strict(),
  },
  "families.apply": {
    says: "Apply the exact family plans a succeeded families.plan action returned (named by that action id), from the spec bytes that plan sealed; each family's plan hash gates drift. Staged cells a successful family consumed retire only if unchanged.",
    needs: "project-document",
    effect: "command",
    dirties: ["families", "pods"],
    input: applyInputSchema,
  },
  "parameter-links.apply": {
    says: "Store the reviewed parameter-link draft and reconcile exactly the evaluated writes the human approved.",
    needs: "project-document",
    effect: "command",
    dirties: ["parameter-links"],
    input: z.object({ readingId: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  },
  "family.build": {
    says: "Build a saved composed family spec to an admitted output path. The target is execution context, not the new family.",
    needs: "document",
    effect: "command",
    dirties: ["family"],
    input: z.object({
      source: podMemberSourceSchema,
      outputPath: z.string().optional(),
      modelDirectory: z.string().optional(),
    }),
  },
} as const;
export const familyReads = {
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
} as const satisfies Record<string, ActionDefinition>;
export type FamilyActionKey = keyof typeof familyActions;
export type FamilyReadKey = keyof typeof familyReads;
