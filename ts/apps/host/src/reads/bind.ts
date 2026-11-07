import { resources } from "../builtin-read-handles.ts";
import { z } from "zod";
import { executionTargetSchema } from "@pe/agent-contracts";
import { read } from "./evaluator.ts";
import { bindData } from "@pe/agent-contracts";
export const reads = {
  picker: read("bind.picker", {
    input: z.object({ target: executionTargetSchema }),
    output: bindData,
    async run(ctx) {
      return {
        threads: await ctx.read(resources.threads, { kind: "threads" }),
        inventory: await ctx.read(resources.inventory, { kind: "inventory" }),
      };
    },
  }),
};
