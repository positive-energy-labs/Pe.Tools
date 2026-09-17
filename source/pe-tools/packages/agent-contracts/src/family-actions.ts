import { z } from "zod";
import { documentRefSchema } from "./target.ts";
import { workKeySchema } from "./route-state.ts";
import { podMemberSchema } from "./settings.ts";
import {
  familiesPlanReadingSchema,
  familyExecutionOptionsSchema,
  ffPlanEntrySchema,
} from "./families.ts";
import { parameterLinksReadingSchema } from "./parameter-links.ts";

export const familyPlanReadingSchema = z.object({
  target: documentRefSchema,
  member: podMemberSchema,
  workspaceId: z.string().min(1),
  path: z.string().min(1),
  fileVersion: z.string().min(1),
  composedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  patchJson: z.string(),
  entry: ffPlanEntrySchema,
  executionOptions: familyExecutionOptionsSchema.optional(),
});
export const familyCaptureSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  key: workKeySchema,
  capturedAt: z.string(),
  provenance: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("live"), target: documentRefSchema }),
    z.object({ kind: z.literal("file") }),
  ]),
  reading: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("plan"), value: familyPlanReadingSchema }),
    // Route readings live beside Family's, in the same owner, under the route's own WorkKey.
    z.object({ kind: z.literal("families-plan"), value: familiesPlanReadingSchema }),
    z.object({ kind: z.literal("parameter-links"), value: parameterLinksReadingSchema }),
    z.object({ kind: z.literal("capture"), value: z.unknown() }),
    z.object({ kind: z.literal("spec"), value: z.unknown() }),
  ]),
});
export type FamilyCapture = z.infer<typeof familyCaptureSchema>;
export const familyActions = {
  "settings.write": {
    says: "Save reviewed Settings Work or create exact raw bytes through the host conditional writer.",
    needs: "nothing",
    actor: "human",
    dirties: ["pods"],
    executors: ["settings.document.save"],
    description:
      "Save reviewed Settings Work or create exact raw bytes through the host conditional writer.",
    input: z.object({
      member: podMemberSchema,
      workspaceId: z.string().min(1),
      write: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("save"), versionToken: z.string().min(1) }),
        z.object({ kind: z.literal("create"), rawContent: z.string() }),
      ]),
    }),
  },
  "family.apply": {
    says: "Apply an immutable reviewed Family plan to its exact document lifetime; preserve native diagnostics.",
    needs: "family-document",
    actor: "human",
    dirties: ["family"],
    executors: ["familyfoundry.apply"],
    description:
      "Apply an immutable reviewed Family plan to its exact document lifetime; preserve native diagnostics.",
    input: z.object({
      planId: z.string().regex(/^[a-f0-9]{64}$/),
      expectedPlanHash: z.string().min(1),
    }),
  },
  "families.apply": {
    says: "Apply the reviewed loaded-family plan reading, minus its authored exclusions, to the exact planned document and profile bytes.",
    needs: "project-document",
    actor: "human",
    dirties: ["families"],
    executors: ["familyfoundry.apply"],
    description:
      "Apply the reviewed loaded-family plan reading, minus its authored exclusions, to the exact planned document and profile bytes.",
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
    says: "Build frozen composed saved JSON to an admitted output path. The target is execution context, not the new family.",
    needs: "document",
    actor: "human",
    dirties: ["family"],
    executors: ["revit.apply.family-model"],
    description:
      "Build frozen composed saved JSON to an admitted output path. The target is execution context, not the new family.",
    input: z.object({
      member: podMemberSchema,
      workspaceId: z.string().min(1),
      fileVersion: z.string().min(1),
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
  "family.plan": {
    says: "Read a plan against an exact family lifetime and original saved JSON token, without changing Work.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "family-document",
    actor: "any",
    description:
      "Read a plan against an exact family lifetime and original saved JSON token, without changing Work.",
    input: z.object({
      member: podMemberSchema,
      workspaceId: z.string().min(1),
      fileVersion: z.string().min(1),
      executionOptions: familyExecutionOptionsSchema.optional(),
    }),
  },
  "families.plan": {
    says: "Read a native plan for the authored Families profile and scope into a durable reading; changes no Work.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "project-document",
    actor: "any",
    description:
      "Read a native plan for the authored Families profile and scope into a durable reading; changes no Work.",
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
  "family.capture": {
    says: "Capture exact family evidence without changing Work or resolving mutations.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "family-document",
    actor: "any",
    description: "Capture exact family evidence without changing Work or resolving mutations.",
    input: z.object({}),
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
