import { z } from "zod";
import { readingRequestSchema } from "@pe/agent-contracts";
import { leaf, read } from "@pe/host/read-graph";
import { chatArgs, chatValue } from "@pe/agent-contracts";

const resource = leaf("resource", readingRequestSchema, z.unknown());
// TODO: S gap 9 must admit typed host commands before exporting thread prompt/cancel/fork here.
export const reads = {
  context: read("chat.context", {
    input: chatArgs,
    output: chatValue,
    async run(ctx) {
      return chatValue.parse({
        machine: await ctx.read(resource, { kind: "machine" }),
        capabilities: await ctx.read(resource, { kind: "capabilities" }),
      });
    },
  }),
};
