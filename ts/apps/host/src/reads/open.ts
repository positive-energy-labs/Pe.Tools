import { z } from "zod";
import { executionTargetSchema } from "@pe/agent-contracts";
import { read, leaf, type InputPort } from "./evaluator.ts";
import { openData } from "@pe/agent-contracts";
const resource = leaf("open.resource", z.record(z.string(), z.unknown()), z.unknown(), false);
export const reads = {
  documents: read("open.documents", {
    input: z.object({ target: executionTargetSchema }),
    output: openData,
    async run(ctx) {
      return {
        machine: await ctx.read(resource, { kind: "machine" }),
        recents: await ctx.read(resource, { kind: "sdk", read: "recents" }),
        threads: openData.shape.threads.parse(await ctx.read(resource, { kind: "threads" })),
      };
    },
  }),
};
export const leaves = {
  "open.resource": (request: unknown, services: InputPort) => services.take("resource", request),
};
