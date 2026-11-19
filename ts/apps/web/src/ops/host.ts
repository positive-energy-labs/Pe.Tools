import * as contracts from "./contract.ts";
import { body } from "@pe/host-internal/read-graph";
import { resources } from "@pe/host-internal/builtin-read-handles";




export const reads = {
  workspace: body(contracts.workspace, async function(ctx, { target, actionId }) {
      const session =
        target.kind === "document"
          ? target.ref.session
          : target.kind === "session"
            ? target.session
            : undefined;
      const catalog = await ctx.read(resources.catalog, {
        kind: "ops-catalog",
        ...(session ? { session } : {}),
      });
      const receipts = await ctx.read(resources.statuses, { kind: "receipts" });
      const receipt = actionId
        ? await ctx.read(resources.receipt, { kind: "receipts", id: actionId })
        : [];
      return { catalog, receipts, receipt };
    }),
};
