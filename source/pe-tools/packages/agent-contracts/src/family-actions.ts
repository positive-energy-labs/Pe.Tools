import { z } from "zod";
import { documentRefSchema } from "./target.ts";
import { workKeySchema } from "./route-state.ts";
import { podMemberSchema, podMemberSourceSchema } from "./settings.ts";
import { familiesPlanReadingSchema } from "./families.ts";
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
    z.object({ kind: z.literal("families-plan"), value: familiesPlanReadingSchema }),
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
    dirties: ["settings"],
    executors: ["pod.member.write"],
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
  "family.apply": {
    says: "Apply a saved family spec. Without planHash the host plans and returns the plan to confirm; with it the host applies that exact plan and writes a run receipt.",
    needs: "family-document",
    actor: "human",
    dirties: ["family", "pods"],
    executors: ["pod.member.compose", "family.plan", "family.apply"],
    description:
      "Apply a saved family spec. Without planHash the host plans and returns the plan to confirm; with it the host applies that exact plan and writes a run receipt.",
    input: z.object({ source: podMemberSourceSchema, planHash: z.string().min(1).optional() }),
  },
  "families.capture": {
    says: "Capture loaded families as new spec members in the route's pod, one member per family.",
    needs: "project-document",
    actor: "any",
    dirties: ["pods"],
    executors: ["families.capture", "pod.member.write"],
    description:
      "Capture loaded families as new spec members in the route's pod, one member per family.",
    input: z.object({ pod: z.string().min(1), familyIds: z.array(z.number().int()).min(1) }),
  },
  "families.apply": {
    says: "Apply the reviewed loaded-family plan reading, minus its authored exclusions, to the exact planned document and spec bytes.",
    needs: "project-document",
    actor: "human",
    dirties: ["families", "pods"],
    executors: ["pod.member.compose", "families.apply"],
    description:
      "Apply the reviewed loaded-family plan reading, minus its authored exclusions, to the exact planned document and spec bytes.",
    input: z.object({
      planId: z.string().regex(/^[a-f0-9]{64}$/),
      expectedPlanHashes: z.record(z.string(), z.string()),
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
    executors: ["pod.member.compose", "revit.apply.family-model"],
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
  "families.plan": {
    says: "Read a native plan for the authored Families spec member and scope into a durable reading; changes no Work.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "project-document",
    actor: "any",
    description:
      "Read a native plan for the authored Families spec member and scope into a durable reading; changes no Work.",
    input: z.object({}),
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
