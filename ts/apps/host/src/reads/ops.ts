import { resources } from "../builtin-read-handles.ts";

import { executionTargetSchema } from "@pe/agent-contracts";
import { read } from "./evaluator.ts";
import { opsArgs, opsData } from "@pe/agent-contracts";
export const reads = {
  workspace: read("ops.workspace", {
    input: opsArgs.extend({ target: executionTargetSchema }),
    output: opsData,
    async run(ctx, { target, actionId }) {
      const session =
        target.kind === "document"
          ? target.ref.session
          : target.kind === "session"
            ? target.session
            : undefined;
      const catalog = await ctx.read(resources.catalog, { kind: "ops-catalog", ...(session ? { session } : {}) });
      const receipts = await ctx.read(resources.statuses, { kind: "receipts" });
      const receipt = actionId
        ? await ctx.read(resources.receipt, { kind: "receipts", id: actionId })
        : [];
      return { catalog, receipts, receipt };
    },
  }),
};
