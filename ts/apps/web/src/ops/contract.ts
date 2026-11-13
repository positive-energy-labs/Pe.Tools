import { executionTargetSchema, opsArgs, opsData } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";

/** The one declaration of each read this route serves: the pane and the host body both take it from here. */
export const workspace = contract("ops.workspace", {
  input: opsArgs.extend({ target: executionTargetSchema }),
  data: opsData,
  uses: [],
  subject: "None",
});
