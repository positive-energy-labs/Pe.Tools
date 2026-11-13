import { executionTargetSchema, familyArgs, familyData } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";

/** The one declaration of each read this route serves: the pane and the host body both take it from here. */
export const workspace = contract("family.workspace", {
  input: familyArgs.extend({ target: executionTargetSchema }),
  data: familyData,
  uses: [],
});
