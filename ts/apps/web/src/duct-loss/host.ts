import * as contracts from "./contract.ts";
import { body } from "@pe/host-internal/read-graph";

import { ductLossData } from "@pe/ducts-contract/duct-loss-read";
import { ductInputError, solve } from "@pe/ducts-domain/duct-loss-math";
export const reads = {
  result: body(contracts.result, (ctx, { target: _target, ...args }) =>
    ctx.compute(ductLossData, args, (input) => {
      const error = ductInputError(input);
      return { error, result: error ? null : solve(input) };
    }),
  ),
};
