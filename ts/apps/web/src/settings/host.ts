import * as contracts from "./contract.ts";
import { body } from "@pe/host/read-graph";
import { resources } from "@pe/host/builtin-read-handles";


import { type SettingTierRead } from "@pe/agent-contracts";

export const reads = {
  machine: body(contracts.machine, async function(ctx) {
      return {
        machine: await ctx.read(resources.machine, { kind: "machine" }),
        // Every owner a route declares a `setting` for. /settings has no target model, so no project home.
        settings: { ducts: await ctx.files.tiers("ducts", null) } as Record<string, SettingTierRead[]>,
      };
    }),
};
