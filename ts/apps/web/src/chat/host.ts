import { resources } from "@pe/host/builtin-read-handles";

import { read } from "@pe/host/read-graph";
import { chatArgs, chatValue } from "@pe/agent-contracts";

// TODO: S gap 9 must admit typed host commands before exporting thread prompt/cancel/fork here.
export const reads = {
  context: read("chat.context", {
    input: chatArgs,
    output: chatValue,
    async run(ctx) {
      return {
        machine: await ctx.read(resources.machine, { kind: "machine" }),
        capabilities: await ctx.read(resources.capabilities, { kind: "capabilities" }),
      };
    },
  }),
};
