import * as contracts from "./contract.ts";
import { body } from "@pe/host-internal/read-graph";
import { resources } from "@pe/host-internal/builtin-read-handles";

// TODO: S gap 9 must admit typed host commands before exporting thread prompt/cancel/fork here.
export const reads = {
  context: body(contracts.context, async function (ctx) {
    return {
      machine: await ctx.read(resources.machine, { kind: "machine" }),
      capabilities: await ctx.read(resources.capabilities, { kind: "capabilities" }),
    };
  }),
};
