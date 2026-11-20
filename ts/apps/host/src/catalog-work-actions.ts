/**
 * ADR 0030 rules 2, 4 and 8, step 4: one generic executor over `catalogWorkCommands`, not one adapter per op.
 * The boundary parses the Work; `prepare` reads the owner's base (what the model holds now) through its one
 * Read owner and derives the native request from both. It runs at the plan and again at preparation, so the
 * seal (request + the observed before) refuses an apply whose base moved; the sealed document mark still
 * guards dispatch. The plan never reaches the leaf. No retire: catalog Work is the authored source.
 */
import { z } from "zod";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import {
  CatalogWorkRefused,
  catalogWorkCommands,
  catalogWorks,
  nativeProcessSchema,
  type CatalogWork,
  type Command,
} from "@pe/agent-contracts";
import type { RevitBridge } from "@pe/host-internal/bridge";
import {
  command,
  nativeStep,
  refused,
  type CommandExecutor,
} from "@pe/host-internal/command-executor";
import { projectReader, type FamilyActionDependencies } from "./family-actions.ts";

type Owner = keyof typeof catalogWorks;

const prepared = z.object({
  process: nativeProcessSchema,
  target: z.object({ session: z.string(), openId: z.string() }),
  request: z.unknown(),
  before: z.unknown(),
  replacement: z.unknown(),
  adoptedReplacement: z.unknown(),
  touched: z.array(z.unknown()),
});

/** One executor per generated apply entry; the registry gives each its plan entry and wraps both in the boundary. */
export function catalogWorkExecutors(
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies = {},
  definitions: Record<
    string,
    Command & { work: { route: string }; writeBoundary: { phase: string } }
  > = catalogWorkCommands as never,
): Record<string, CommandExecutor> {
  return Object.fromEntries(
    Object.entries(definitions)
      .filter(([, definition]) => definition.writeBoundary.phase === "apply")
      .map(([key, definition]) => {
        const owner = definition.work.route as Owner;
        const work = catalogWorks[owner] as CatalogWork<z.ZodType, unknown>;
        const executor = command(definition, prepared, {
          // The before the plan observed is evidence: a moved base changes the seal, never the request silently.
          seal: (p) => ({
            request: p.request,
            evidence: { before: p.before, touched: p.touched, replacement: p.replacement },
          }),
          bind: async (ctx) => {
            if (ctx.admission.target.kind !== "document") throw refused("Exact document required");
            const target = ctx.admission.target.ref;
            const { doc } = ctx.admission.input as { doc: unknown };
            return {
              effects: [{ kind: "document", ref: target }],
              prepare: async () => {
                // K3 / ADR 0030 rule 8: governor keeps data-table apply refused until root accepts the class
                // falsifier (keyed-write-coverage.test.ts) and the fresh DataTableKeyedApplyTests. The keyed derive
                // below is complete; this line is the only gate.
                if (owner === "data-tables")
                  throw refused(
                    "Data-table apply stays refused until its keyed falsifier is accepted",
                    "catalog.table-base-required",
                  );
                try {
                  // The owner's declared base, through the one fenced project Read owner (no capture).
                  const reader = await projectReader(bridge, target, deps);
                  const observed = await reader.read(work.base.op, work.base.input(doc));
                  const before = work.base.project(observed, doc);
                  const replacement =
                    owner === "parameter-links"
                      ? nativeResponseSchema("revit.detail.parameter-links").parse(observed)
                          .replacement
                      : undefined;
                  const plan = ctx.read
                    .receipts(ctx.admission.id)
                    .find((r) => r.key === `${key}.plan` && r.state === "succeeded");
                  const adoptedReplacement =
                    plan?.state === "succeeded"
                      ? (plan.result as { evidence?: { replacement?: unknown } }).evidence
                          ?.replacement
                      : undefined;
                  const { request, touched } = work.derive(doc, before);
                  return {
                    target,
                    process: reader.process,
                    request,
                    before,
                    replacement,
                    adoptedReplacement,
                    touched: [...touched],
                  };
                } catch (error) {
                  if (error instanceof CatalogWorkRefused)
                    throw refused(error.message, "catalog.refused");
                  throw error;
                }
              },
            };
          },
          run: (_ctx, execution) => {
            const { target, request, adoptedReplacement } = execution.prepared;
            const input = adoptedReplacement
              ? { ...(request as object), replacement: adoptedReplacement }
              : request;
            return execution.step(
              "native",
              work.op,
              input,
              (id) => nativeStep(bridge, target, work.op, input, id),
              { process: execution.prepared.process },
            );
          },
        });
        return [key, executor];
      }),
  );
}
