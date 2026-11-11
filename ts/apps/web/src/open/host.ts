import { resources } from "@pe/host/builtin-read-handles";
import { z } from "zod";
import { executionTargetSchema } from "@pe/agent-contracts";
import { read } from "@pe/host/read-graph";
import { openData } from "@pe/agent-contracts";
export const reads = {
  documents: read("open.documents", {
    input: z.object({ target: executionTargetSchema }),
    output: openData,
    async run(ctx) {
      return {
        machine: await ctx.read(resources.machine, { kind: "machine" }),
        recents: await ctx.read(resources.recents, { kind: "sdk", read: "recents" }),
        threads: await ctx.read(resources.threads, { kind: "threads" }),
      };
    },
  }),
};
