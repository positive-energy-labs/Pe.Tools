import { contract } from "@pe/agent-contracts/handle";
import { executionTargetSchema } from "@pe/agent-contracts/target";
import { args, value, key } from "./schema.ts";

export const sizing = contract(`${key}.sizing`, {
  input: args.extend({ target: executionTargetSchema }), data: value,
  uses: ["mep.system.members", "mep.segment.sizes"],
});
