import { executionTargetSchema } from "@pe/agent-contracts";
import { read } from "../../../host/src/reads/evaluator.ts";
import { ductLossArgs, ductLossData } from "@pe/agent-contracts";
import { ductInputError, solve } from "@pe/ducts-domain/duct-loss-math";
export const reads = {
  result: read("duct-loss.result", {
    input: ductLossArgs.extend({ target: executionTargetSchema }),
    output: ductLossData,
    run: (ctx, { target: _target, ...args }) =>
      ctx.compute(ductLossData, args, (input) => {
        const error = ductInputError(input);
        return { error, result: error ? null : solve(input) };
      }),
  }),
};
