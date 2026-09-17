import { z } from "zod";
import { documentRefSchema } from "./target.ts";
import { workKeySchema } from "./route-state.ts";
import { podMemberSchema, podMemberSourceSchema } from "./settings.ts";
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
    z.object({ kind: z.literal("spec"), value: z.unknown() }),
  ]),
});
export type FamilyCapture = z.infer<typeof familyCaptureSchema>;
/** Where a capture lands: the route's current pod, and a new member path the host may choose. */
const captureInto = { pod: z.string().min(1), path: z.string().min(1).optional() };
export const familyActions = {
  "settings.write": {
    says: "Save reviewed member Work, or create exact raw bytes, through the host pod member writer.",
    needs: "nothing",
    actor: "human",
    dirties: ["pods"],
    executors: ["pod.member.write", "pod.member.save"],
    description:
      "Save reviewed member Work, or create exact raw bytes, through the host pod member writer.",
    input: z.object({
      member: podMemberSchema,
      write: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("save"), sha256: z.string().min(1) }),
        z.object({ kind: z.literal("create"), rawContent: z.string() }),
      ]),
    }),
  },
  "family.capture": {
    says: "Capture the open family as a new spec member in the route's pod; returns the member address and sha256.",
    needs: "family-document",
    actor: "any",
    dirties: ["pods"],
    executors: ["family.capture", "pod.member.write"],
    description:
      "Capture the open family as a new spec member in the route's pod; returns the member address and sha256.",
    input: z.object(captureInto),
  },
  "family.plan": {
    says: "Plan a saved family spec against the open family and return the plan; changes nothing.",
    needs: "family-document",
    actor: "any",
    dirties: [],
    executors: ["pod.member.compose", "family.plan"],
    description:
      "Plan a saved family spec against the open family and return the plan; changes nothing.",
    input: z.object({ source: podMemberSourceSchema }),
  },
  "family.apply": {
    says: "Apply the exact family plan family.plan returned (its one-entry `included` record), from the same saved spec bytes, and write a run receipt.",
    needs: "family-document",
    actor: "human",
    dirties: ["family", "pods"],
    executors: ["pod.member.compose", "family.apply"],
    description:
      "Apply the exact family plan family.plan returned (its one-entry `included` record), from the same saved spec bytes, and write a run receipt.",
    input: z.object({
      source: podMemberSourceSchema,
      // The families shape; a family document plans exactly one family.
      expectedPlanHashes: z
        .record(z.string(), z.string().min(1))
        .refine((hashes) => Object.keys(hashes).length === 1, "Send exactly one family plan hash"),
    }),
  },
  "families.capture": {
    says: "Capture loaded families as new spec members in the route's pod, one member per family; returns the members and what the capture saw per family.",
    needs: "project-document",
    actor: "any",
    dirties: ["pods"],
    executors: ["families.capture", "pod.member.write"],
    description:
      "Capture loaded families as new spec members in the route's pod, one member per family; returns the members and what the capture saw per family.",
    input: z.object({ pod: z.string().min(1), familyIds: z.array(z.number().int()).min(1) }),
  },
  "families.plan": {
    says: "Plan a saved spec over the loaded families in the reviewed Families Work scope; returns the plan and the hashes apply would send, and changes nothing.",
    needs: "project-document",
    actor: "any",
    dirties: [],
    executors: ["pod.member.compose", "families.plan"],
    description:
      "Plan a saved spec over the loaded families in the reviewed Families Work scope; returns the plan and the hashes apply would send, and changes nothing.",
    input: z.object({
      source: podMemberSourceSchema,
      excludedIds: z.array(z.number().int()).default([]),
      executionOptions: familyExecutionOptionsSchema.optional(),
    }),
  },
  "families.apply": {
    says: "Apply the exact family plans families.plan returned, from the same saved spec bytes; each family's plan hash gates drift.",
    needs: "project-document",
    actor: "human",
    dirties: ["families", "pods"],
    executors: ["pod.member.compose", "families.apply"],
    description:
      "Apply the exact family plans families.plan returned, from the same saved spec bytes; each family's plan hash gates drift.",
    input: z.object({
      source: podMemberSourceSchema,
      expectedPlanHashes: z.record(z.string(), z.string()),
      executionOptions: familyExecutionOptionsSchema.optional(),
    }),
  },
  "parameter-links.apply": {
    says: "Store the reviewed parameter-link draft and reconcile exactly the evaluated writes the human approved.",
    needs: "project-document",
    actor: "human",
    dirties: ["parameter-links"],
    executors: ["revit.apply.parameter-links"],
    description:
      "Store the reviewed parameter-link draft and reconcile exactly the evaluated writes the human approved.",
    input: z.object({ readingId: z.string().regex(/^[a-f0-9]{64}$/) }),
  },
  "family.build": {
    says: "Build a saved composed family spec to an admitted output path. The target is execution context, not the new family.",
    needs: "document",
    actor: "human",
    dirties: ["family"],
    executors: ["pod.member.compose", "family.build"],
    description:
      "Build a saved composed family spec to an admitted output path. The target is execution context, not the new family.",
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
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "nothing",
    actor: "any",
    description:
      "Read an immutable saved Family reading, including historical citation IDs, without Revit.",
    input: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }),
  },
  "parameter-links.read": {
    says: "Read the stored parameter-link profile and runtime status, and optionally evaluate the authored draft, into a durable reading; writes nothing.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "project-document",
    actor: "any",
    description:
      "Read the stored parameter-link profile and runtime status, and optionally evaluate the authored draft, into a durable reading; writes nothing.",
    input: z.object({ evaluate: z.boolean().default(false) }),
  },
  "family.parse-spec": {
    says: "Read parsed spec blocks and image citations into a durable immutable reading.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "nothing",
    actor: "any",
    description: "Read parsed spec blocks and image citations into a durable immutable reading.",
    input: z.object({ url: z.string().url() }),
  },
} as const;
export type FamilyActionKey = keyof typeof familyActions;
export type FamilyReadKey = keyof typeof familyReads;
