import { resources } from "../builtin-read-handles.ts";

import { read } from "@pe/host/read-graph";
import { settingsArgs, settingsValue } from "@pe/agent-contracts";

export const reads = {
  machine: read("settings.machine", {
    input: settingsArgs,
    output: settingsValue,
    async run(ctx) {
      return { machine: await ctx.read(resources.machine, { kind: "machine" }) };
    },
  }),
};
