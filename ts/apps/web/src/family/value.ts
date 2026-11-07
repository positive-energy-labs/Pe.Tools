import { z } from "zod";
import { familyDraftSchema, settingsSnapshotSchema, parsedDocViewSchema, podMemberSchema, workHandleSchema } from "@pe/agent-contracts";
export const familyArgs = z.object({member: podMemberSchema.nullable()});
export const familyData = z.object({
  familyWork: familyDraftSchema, handle: workHandleSchema.nullable(),
  profile: settingsSnapshotSchema.nullable(), profileError: z.string().nullable(),
  spec: z.object({member: podMemberSchema, doc: parsedDocViewSchema}).nullable(), specError: z.string().nullable(),
  pods: z.array(z.object({id:z.string(), name:z.string(), members:z.array(z.object({path:z.string(),sha256:z.string(),schema:z.string().nullable().optional()}))})),
});
export interface FamilySpecReading { member: z.output<typeof podMemberSchema>; doc: z.output<typeof parsedDocViewSchema>; }
export const readingValue = <T>(value: {value?: unknown; previous?: unknown} | undefined): T | null => (value?.value ?? value?.previous ?? null) as T | null;
