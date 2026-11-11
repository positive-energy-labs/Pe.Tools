import { read } from "@pe/host/read-graph";
import { capturesArgs, capturesValue } from "@pe/agent-contracts";
import { captures } from "@pe/host/builtin-read-handles";
export const reads = {
  browse: read("captures.browse", {
    input: capturesArgs,
    output: capturesValue,
    run: (ctx) => ctx.read(captures, { kind: "captures" as const }),
  }),
};
