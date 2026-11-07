import { z } from "zod";
import { readingRequestSchema } from "@pe/agent-contracts";
import { leaf, read } from "./evaluator.ts";
import { chatArgs, chatValue } from "@pe/agent-contracts";

const resource = leaf("resource", readingRequestSchema, z.unknown());
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
