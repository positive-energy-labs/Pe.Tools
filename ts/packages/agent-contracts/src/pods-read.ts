import { z } from "zod";
import { Schema } from "effect";
import { podMemberSchema, settingsRouteState } from "./settings.ts";
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
  runs: podRunsSchema,
});
export const podMemberOfPage = (page: { pod: string; path: string }) =>
  podMemberSchema.safeParse({ pod: page.pod, path: page.path }).data ?? null;
