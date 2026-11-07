import { z } from "zod";
import { executionTargetSchema } from "@pe/agent-contracts";
import { leaf, read, type InputPort } from "./evaluator.ts";
import { bindData } from "@pe/agent-contracts";
const resource = leaf("bind.resource", z.record(z.string(), z.unknown()), z.unknown());
export const reads = {
  picker: read("bind.picker", {
    input: z.object({ target: executionTargetSchema }),
    output: bindData,
    async run(ctx) {
      return {
        threads: bindData.shape.threads.parse(await ctx.read(resource, { kind: "threads" })),
        inventory: bindData.shape.inventory.parse(await ctx.read(resource, { kind: "inventory" })),
      };
    },
  }),
};
export const leaves = {
  "bind.resource": (request: unknown, services: InputPort) => services.take("resource", request),
};
