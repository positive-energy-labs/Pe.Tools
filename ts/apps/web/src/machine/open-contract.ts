import { executionTargetSchema, openData } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";
import { z } from "zod";

/** Open and Sessions share one document-discovery read. */
export const documents = contract("open.documents", {
  input: z.object({ target: executionTargetSchema }),
  data: openData,
  uses: [],
  subject: "None",
});
