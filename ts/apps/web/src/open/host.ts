import * as contracts from "./contract.ts";
import { body } from "@pe/host/read-graph";
import { resources } from "@pe/host/builtin-read-handles";




export const reads = {
  documents: body(contracts.documents, async function(ctx) {
      return {
        machine: await ctx.read(resources.machine, { kind: "machine" }),
        recents: await ctx.read(resources.recents, { kind: "sdk", read: "recents" }),
        threads: await ctx.read(resources.threads, { kind: "threads" }),
      };
    }),
};
