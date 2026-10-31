import { z } from "zod";
import { canonicalRouteInput, commands, tools, nativeProcessSchema } from "@pe/agent-contracts";
import type { DataTableApply } from "@pe/host-contracts/generated";
import { invokeBridge, type RevitBridge } from "./bridge.ts";
import { command, refused } from "./command-executor.ts";
import { lifetime } from "./family-actions.ts";
import { nativeInputSchema } from "./native-input.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";

export function dataTableExecutors(
  bridge: RevitBridge["Service"],
  deps: { sdk?: SdkReceiptReader } = {},
) {
  return {
    "data-table.apply": command(
      commands["data-table.apply"],
      z.object({
        process: nativeProcessSchema,
        input: nativeInputSchema("data-table.apply"),
      }),
      {
        bind: async (ctx) => {
          const { target, input } = ctx.admission;
          if (target.kind !== "document") throw refused("Exact project document required");
          if (!input.work) throw refused("Work has not been read yet");
          const { draft } = await ctx.selectWork(tools["data-tables"].work, input.work, () => ({
            facts: [["draft"]],
          }));
          if (!draft) throw refused("Choose a table or start a new one first");
          const { isNew: _, ...table } = draft;
          if (
            canonicalRouteInput(input.table) !==
            canonicalRouteInput({ ...table, pruneMissingRows: true })
          )
            throw refused("The reviewed table differs from the current draft");
          const { process } = await lifetime(bridge, target.ref, "project", deps);
          return {
            consumes: [{ kind: "incarnation", probe: { target, process }, expected: true }],
            effects: [{ kind: "document", ref: target.ref }],
            prepare: async () => ({ process, input: { table: input.table } }),
          };
        },
        run: async (ctx, execution) => {
          const { target, input } = ctx.admission;
          if (target.kind !== "document" || !input.work)
            throw refused("Exact document and Work required");
          const prepared = execution.prepared;
          const native = await execution.step(
            "native",
            "data-table.apply",
            prepared.input,
            (id) =>
              invokeBridge<DataTableApply.Res.Response>(
                bridge,
                target.ref,
                "data-table.apply",
                prepared.input,
                id,
              ),
            { process: prepared.process },
          );
          if (!native.table || native.dryRun) throw Error("Apply returned no persisted table");
          const publication = await execution.publishWork(input.work.key, "data-tables", [
            { path: ["draft", "isNew"], value: false },
          ]);
          return { name: native.table.name, native, publication, warnings: native.warnings };
        },
      },
    ),
  };
}
