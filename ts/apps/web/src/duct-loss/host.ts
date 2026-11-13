import * as contracts from "./contract.ts";
import { body } from "@pe/host/read-graph";


import { ductLossData } from "@pe/agent-contracts";
import { ductInputError, solve } from "@pe/ducts-domain/duct-loss-math";
export const reads = {
  result: body(contracts.result, (ctx, { target: _target, ...args }) =>
      ctx.compute(ductLossData, args, (input) => {
        const error = ductInputError(input);
        return { error, result: error ? null : solve(input) };
      })),
};
