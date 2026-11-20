import * as contracts from "./contract.ts";
import { body } from "@pe/host-internal/read-graph";
import { resources } from "@pe/host-internal/builtin-read-handles";

import { settingOwners } from "@pe/mcps/product-contracts";

export const reads = {
  machine: body(contracts.machine, async function (ctx) {
    return {
      machine: await ctx.read(resources.machine, { kind: "machine" }),
      // Every owner a route declares a `setting` for. /settings has no target model, so no project home.
      settings: Object.fromEntries(
        await Promise.all(
          Object.keys(settingOwners).map(async (owner) => [
            owner,
            await ctx.files.tiers(owner, null),
          ]),
        ),
      ),
    };
  }),
};
