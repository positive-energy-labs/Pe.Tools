import { z } from "zod";
import { executionTargetSchema } from "@pe/agent-contracts";
import { read, leaf, type InputPort } from "./evaluator.ts";
import { opsArgs, opsData } from "@pe/agent-contracts";
const resource = leaf("ops.resource", z.record(z.string(), z.unknown()), z.unknown());
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
      const catalog = opsData.shape.catalog.parse(
        await ctx.read(resource, { kind: "ops-catalog", ...(session ? { session } : {}) }),
      );
      const receipts = opsData.shape.receipts.parse(await ctx.read(resource, { kind: "receipts" }));
      const receipt = actionId
        ? opsData.shape.receipt.parse(await ctx.read(resource, { kind: "receipts", id: actionId }))
        : [];
      return { catalog, receipts, receipt };
    },
  }),
};
export const leaves = {
  "ops.resource": (request: unknown, services: InputPort) => services.take("resource", request),
};
