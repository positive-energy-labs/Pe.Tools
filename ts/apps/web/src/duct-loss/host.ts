import { executionTargetSchema } from "@pe/agent-contracts";
import { read } from "../../../host/src/reads/evaluator";
import { ductLossArgs, ductLossData } from "./value";
import { ductInputError, solve } from "./duct/math";
export const reads = { result: read("duct-loss.result", {
  input: ductLossArgs.extend({ target: executionTargetSchema }), output: ductLossData,
  run: (ctx, { target: _target, ...args }) => ctx.compute(ductLossData, args, input => {
    const error = ductInputError(input);
    return { error, result: error ? null : solve(input) };
  }),
}) };
