/**
 * ADR 0030 rules 2, 4 and 8, step 4: one generic executor over `catalogWorkCommands`, not one adapter per op.
 * The boundary parses the Work; `prepare` reads the owner's base (what the model holds now) through its one
 * Read owner and derives the native request from both. It runs at the plan and again after consent, so the
 * seal (request + the observed before) refuses an apply whose base moved; the sealed document mark still
 * guards dispatch. The plan never reaches the leaf. No retire: catalog Work is the authored source.
 */
import { z } from "zod";
import {
  CatalogWorkRefused,
  catalogWorkCommands,
  catalogWorks,
  type CatalogWork,
  type Command,
  type DocumentRef,
} from "@pe/agent-contracts";
import { invokeBridge as invoke, type RevitBridge } from "./bridge.ts";
import { command, refused, type CommandExecutor } from "./command-executor.ts";
import { storedParameterLinks, type FamilyActionDependencies } from "./family-actions.ts";

type Owner = keyof typeof catalogWorks;
type Base = (bridge: RevitBridge["Service"], target: DocumentRef, deps: FamilyActionDependencies) => Promise<unknown>;
/** Each owner's base reader; an owner whose derive reads no model state has none. */
const bases: Partial<Record<Owner, Base>> = { "parameter-links": storedParameterLinks };

const prepared = z.object({
  target: z.object({ session: z.string(), openId: z.string() }),
  request: z.unknown(),
  before: z.unknown(),
  touched: z.array(z.unknown()),
});

/** One executor per generated apply entry; the registry gives each its plan entry and wraps both in the boundary. */
export function catalogWorkExecutors(
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies = {},
  definitions: Record<string, Command & { work: { route: string }; writeBoundary: { phase: string } }> =
    catalogWorkCommands as never,
): Record<string, CommandExecutor> {
  return Object.fromEntries(
    Object.entries(definitions)
      .filter(([, definition]) => definition.writeBoundary.phase === "apply")
      .map(([key, definition]) => {
        const owner = definition.work.route as Owner;
        const work = catalogWorks[owner] as CatalogWork<z.ZodType, unknown>;
        const executor = command(definition, prepared, {
          // The before the plan observed is evidence: a moved base changes the seal, never the request silently.
          seal: (p) => ({ request: p.request, evidence: { before: p.before, touched: p.touched } }),
          bind: async (ctx) => {
            if (ctx.admission.target.kind !== "document") throw refused("Exact document required");
            const target = ctx.admission.target.ref;
            const { doc } = ctx.admission.input as { doc: unknown };
            return {
              effects: [{ kind: "document", ref: target }],
              prepare: async () => {
                // K3 / ADR 0030 rule 8: whole-table reconcile deletes omitted columns. Refuse until
                // the catalog patch contract preserves untouched keys and supplies the stored before.
                if (owner === "data-tables")
                  throw refused("Data-table apply requires a stored-state plan that preserves unstaged keys", "catalog.table-base-required");
                const before = (await bases[owner]?.(bridge, target, deps)) ?? null;
                try {
                  const { request, touched } = work.derive(doc, before);
                  return { target, request, before, touched: [...touched] };
                } catch (error) {
                  if (error instanceof CatalogWorkRefused) throw refused(error.message, "catalog.refused");
                  throw error;
                }
              },
            };
          },
          run: async (_ctx, execution) => {
            const { target, request } = execution.prepared;
            return execution.step("native", work.op, request, (id) => invoke(bridge, target, work.op, request, id));
          },
        });
        return [key, executor];
      }),
  );
}
