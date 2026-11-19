import { z } from "zod";
import { documentRefSchema, executionTargetSchema, workKeySchema } from "@pe/agent-contracts";
import { leaf, read } from "./door.ts";

const targetSchema = z.union([documentRefSchema, executionTargetSchema]);
export const workBinding = leaf(
  "work-scope",
  z.object({
    route: z.string(),
    target: targetSchema.optional(),
    work: z.string().nullable().optional(),
  }),
  workKeySchema.nullable(),
  false,
);
/** The contract is supplied once by the Work owner; routes never decode Work envelopes. */
export const workRead = <T>(owner: string, schema: z.ZodType<T>) => {
  const output = z.object({ doc: schema, revision: z.number() }).nullable();
  return read(`input.work.${owner}`, {
    input: workKeySchema,
    output,
    async run(ctx, scope) {
      return output.parse(await ctx.work(owner, scope));
    },
  });
};
