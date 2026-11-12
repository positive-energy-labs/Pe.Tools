import { z } from "zod";
import { heldSendRequestSchema, type HeldSendRequest } from "@pe/agent-contracts";
import { sendHeldParse } from "@pe/mcps/held-parse";
import { command, io } from "./command-executor.ts";

/** Confirm admits once; the journal owns the upload, outcome and notice after HTTP returns. */
export const outwardSendExecutor = (send: (request: HeldSendRequest) => Promise<void> = sendHeldParse) =>
  command(
    {
      says: "Send the confirmed document to LlamaCloud",
      needs: "nothing",
      principal: ["human"],
      effect: "command",
      dirties: [],
      input: heldSendRequestSchema,
    },
    z.null(),
    {
      async bind() {
        return { effects: [] };
      },
      run(context, execution) {
        return execution.step("file", "outward.send", context.admission.input, () =>
          io(() => send(context.admission.input)),
        );
      },
    },
  );
