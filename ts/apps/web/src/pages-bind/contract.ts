import { bindData, executionTargetSchema } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";
import { z } from "zod";

/** The one declaration of each read this route serves: the pane and the host body both take it from here. */
export const picker = contract("bind.picker", {
  input: z.object({ target: executionTargetSchema }),
  data: bindData,
  uses: [],
  subject: "None",
});
