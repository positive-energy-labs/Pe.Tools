/**
 * ADR 0030 rules 2 and 4, step 4: one generic executor over `catalogWorkCommands`, not one adapter per op.
 * `workWriteBoundary` derives the native request from Work (the entry's `derivation.derive`), seals it at the
 * plan and rechecks it at apply. The plan never reaches this executor's leaf, so it sends nothing native; the
 * apply sends the sealed request to the owner's `op`. No retire: catalog Work is the authored source, so a
 * receipt keeps its cells (CONTRACT-IMPLEMENTATION "Shapes chosen").
 */
import { z } from "zod";
import { catalogWorkCommands, catalogWorks, type Command } from "@pe/agent-contracts";
import { invokeBridge as invoke, type RevitBridge } from "./bridge.ts";
import { command, refused, type CommandExecutor } from "./command-executor.ts";

const prepared = z.object({
  target: z.object({ session: z.string(), openId: z.string() }),
  request: z.unknown(),
});

/** One executor per generated apply entry; the registry gives each its plan entry and wraps both in the boundary. */
export function catalogWorkExecutors(
  bridge: RevitBridge["Service"],
  definitions: Record<string, Command & { work: { route: string }; writeBoundary: { phase: string } }> =
    catalogWorkCommands as never,
): Record<string, CommandExecutor> {
  return Object.fromEntries(
    Object.entries(definitions)
      .filter(([, definition]) => definition.writeBoundary.phase === "apply")
      .map(([key, definition]) => {
        const { op } = catalogWorks[definition.work.route as keyof typeof catalogWorks];
        const executor = command(definition, prepared, {
          seal: (p) => ({ request: p.request }),
          bind: async (ctx) => {
            if (ctx.admission.target.kind !== "document") throw refused("Exact document required");
            const target = ctx.admission.target.ref;
            // The boundary already replaced the input with the derived request beside its Work handle.
            const { work: _work, readWorks: _readWorks, ...request } = ctx.admission.input as Record<string, unknown>;
            return {
              effects: [{ kind: "document", ref: target }],
              prepare: async () => ({ target, request }),
            };
          },
          run: async (_ctx, execution) => {
            const { target, request } = execution.prepared;
            return execution.step("native", op, request, (id) => invoke(bridge, target, op, request, id));
          },
        });
        return [key, executor];
      }),
  );
}
