import { z } from "zod";
import { Schema } from "effect";
import { podMemberSchema, settingsRouteState, type PodMember } from "./settings.ts";
import { goalSchema } from "./slots/goal.ts";
import { decode, subjectCode, type SubjectRefCode } from "./subject-ref.ts";
import {
  podListResponseSchema,
  podRunsResponseSchema,
  podMemberComposeResponseSchema,
} from "@pe/host-contracts/operation-types";

// The kernel speaks Zod; host payload meaning stays in its canonical Effect decoder.
function decoded<T>(decode: (input: unknown) => T) {
  return z.unknown().transform((input, ctx) => {
    try {
      return decode(input);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: String(error) });
      return z.NEVER;
    }
  });
}
export const podRowsSchema = decoded(Schema.decodeUnknownSync(podListResponseSchema.fields.pods));
export const podRunsSchema = decoded(Schema.decodeUnknownSync(podRunsResponseSchema.fields.runs));
export const memberReadSchema = z.object({
  member: podMemberSchema,
  content: z.string(),
  sha256: z.string(),
  schemaJson: z.string().optional(),
});
export const compositionReadSchema = z.object({
  member: podMemberSchema,
  draft: z.string(),
  result: decoded(Schema.decodeUnknownSync(podMemberComposeResponseSchema)),
});

export const podsArgs = z.object({
  pod: z.string(),
  path: z.string(),
  runs: z.enum(["member", "pod"]),
});
export const podsRosterValue = z.object({ pods: podRowsSchema });
export const podsValue = z.object({
  scope: podsArgs,
  member: memberReadSchema.nullable(),
  work: settingsRouteState.schema.nullable(),
  composition: compositionReadSchema.nullable(),
  draft: z.string(),
  schemaRef: z.string().nullable(),
  runs: podRunsSchema,
  // The member's Goal (ADR 0035 rule 8): what is left before a run can consume these bytes.
  ...goalSchema(z.string()).shape,
  // The member's cells are the sheet's; the Goal carries none of its own.
  inputs: z.array(z.never()).readonly(),
});
export const podMemberOfPage = (page: { pod: string; path: string }) =>
  podMemberSchema.safeParse({ pod: page.pod, path: page.path }).data ?? null;
/** A Pod member as a subject: keyKind `name`, the tuple `[pod, path]` (ADR 0035 rule 2). */
export const podMemberCode = (member: PodMember): SubjectRefCode =>
  subjectCode({ keyKind: "name", key: [member.pod, member.path] });
/** The member a subject code names, or null for any other subject. */
export const podMemberOfCode = (code: string | undefined): PodMember | null => {
  const ref = code === undefined ? null : decode(code);
  if (!ref?.ok || ref.value.keyKind !== "name" || ref.value.key.length !== 2) return null;
  return podMemberSchema.safeParse({ pod: ref.value.key[0], path: ref.value.key[1] }).data ?? null;
};
