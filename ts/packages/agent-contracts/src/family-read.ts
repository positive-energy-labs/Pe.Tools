import { z } from "zod";
import { familyDraftSchema } from "./family.ts";
import { settingsSnapshotSchema, podMemberSchema } from "./settings.ts";
import { parsedDocViewSchema } from "./grounded-doc.ts";
import { workHandleSchema } from "./command.ts";
export const familyArgs = z.object({ member: podMemberSchema.nullable() });
export const familyData = z.object({
  familyWork: familyDraftSchema,
  handle: workHandleSchema.nullable(),
  profile: settingsSnapshotSchema.nullable(),
  profileError: z.string().nullable(),
  spec: z.object({ member: podMemberSchema, doc: parsedDocViewSchema }).nullable(),
  specError: z.string().nullable(),
  pods: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      members: z.array(
        z.object({
          path: z.string(),
          sha256: z.string(),
          schema: z.string().nullable().optional(),
        }),
      ),
    }),
  ),
});
