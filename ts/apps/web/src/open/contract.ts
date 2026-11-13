import { executionTargetSchema, openData } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";
import { z } from "zod";

/** The one declaration of each read this route serves: the pane and the host body both take it from here. */
export const documents = contract("open.documents", {
  input: z.object({ target: executionTargetSchema }),
  data: openData,
  uses: [],
  subject: "None",
});
