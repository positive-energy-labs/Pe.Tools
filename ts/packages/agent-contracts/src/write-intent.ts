import { z } from "zod";
import { draftCellSchema } from "./draft.ts";
import { workHandleSchema, type Command, type WorkHandle } from "./command.ts";

/** Operation options are authored cells; suggestions never authorize a write. */
export const writeIntentSchema = z.record(
  z.string(),
  draftCellSchema(z.record(z.string(), z.json())),
);

export function workWriteCommand<const C extends Command>(
  route: string,
  key: string,
  definition: C,
) {
  const { input: authoredInput, work: _work, ...metadata } = definition;
  return {
    ...metadata,
    authoredInput: authoredInput as C["input"],
    writeBoundary: { route, key },
    input: z.strictObject({ work: workHandleSchema, previewOnly: z.boolean().default(false) }),
    work: {
      route,
      bind: (input: { previewOnly?: boolean }, handle: WorkHandle) => ({
        work: handle,
        previewOnly: input.previewOnly ?? false,
      }),
    },
  };
}
