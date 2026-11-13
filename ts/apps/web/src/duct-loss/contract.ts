import { ductLossArgs, ductLossData, executionTargetSchema } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";

/** The one declaration of each read this route serves: the pane and the host body both take it from here. */
export const result = contract("duct-loss.result", {
  input: ductLossArgs.extend({ target: executionTargetSchema }),
  data: ductLossData,
  uses: [],
  // A calculator: it reads its own arguments and no model.
  subject: "None",
});
