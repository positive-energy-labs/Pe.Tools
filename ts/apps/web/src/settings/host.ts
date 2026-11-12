import { resources } from "@pe/host/builtin-read-handles";

import { read } from "@pe/host/read-graph";
import { settingsArgs, settingsValue, type SettingTierRead } from "@pe/agent-contracts";

export const reads = {
  machine: read("settings.machine", {
    input: settingsArgs,
    output: settingsValue,
    async run(ctx) {
      return {
        machine: await ctx.read(resources.machine, { kind: "machine" }),
        // Every owner a route declares a `setting` for. /settings has no target model, so no project home.
        settings: { ducts: await ctx.settings("ducts", null) } as Record<string, SettingTierRead[]>,
      };
    },
  }),
};
