import {
  commands,
  tools,
  ductsHealInputSchema,
  nativeProcessSchema,
  type DuctsHealInput,
} from "@pe/agent-contracts";
import { healPlan, healRequestGroup } from "@pe/ducts-domain/heal";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { z } from "zod";
import { invokeBridge, type RevitBridge } from "./bridge.ts";
import { command, refused, type CommandContext } from "./command-executor.ts";
import type { ActionExecution } from "./action-journal.ts";
import { lifetime } from "./family-actions.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { nativeInputSchema } from "./native-input.ts";

const losses = (preview: boolean) =>
  nativeInputSchema("ducts.apply").refine((input) => input.previewOnly === preview);
const heal = (preview: boolean) =>
  nativeInputSchema("ducts.heal").refine(
    (input) => input.previewOnly === preview && input.groups.every((group) => group.items),
    "Heal groups must be planned",
  );
const fan = (preview: boolean) =>
  nativeInputSchema("ducts.assign-fan").refine((input) => input.previewOnly === preview);
const prepared = <S extends z.ZodType>(input: S) =>
  z.object({ process: nativeProcessSchema, input });

/** Resolve missing heal items once, before the exact native request is durably prepared. */
async function planned(input: DuctsHealInput, read: () => Promise<DuctSnapshot>) {
  if (input.groups.every((group) => group.items)) return input;
  const plan = healPlan(await read());
  return {
    groups: input.groups.map((group) => {
      if (group.items) return group;
      const found = plan.groups.find((item) => item.group === group.group);
      if (!found)
        throw refused(
          `Group ${group.group} has nothing to heal (or no such group in the snapshot)`,
        );
      return healRequestGroup(found);
    }),
  };
}

/** The stable entry owns its native operation; preparation owns only captured input and process. */
export function ductsExecutors(
  bridge: RevitBridge["Service"],
  deps: { sdk?: SdkReceiptReader } = {},
) {
  const targetOf = (ctx: CommandContext) => {
    if (ctx.admission.target.kind !== "document") throw refused("Exact document target required");
    return ctx.admission.target.ref;
  };
  const bind = async (ctx: CommandContext, losses: boolean, previewOnly: boolean) => {
    const target = targetOf(ctx),
      { process } = await lifetime(bridge, target, "project", deps);
    const handle = (ctx.admission.input as { work?: import("@pe/agent-contracts").WorkHandle })
      .work;
    if (handle)
      await ctx.selectWork(tools.ducts.work, handle, (_doc, cells) => ({
        cells: losses
          ? cells
              .filter(
                ({ path, cell }) =>
                  cell.edit && !["systemColours", "claims", "subject"].includes(String(path[0])),
              )
              .map(({ path }) => path)
          : [],
      }));
    return {
      consumes: [
        {
          kind: "incarnation" as const,
          probe: { target: ctx.admission.target, process },
          expected: true as const,
        },
      ],
      effects: previewOnly ? [] : [{ kind: "document" as const, ref: target }],
      process,
    };
  };
  const bindLosses = async (ctx: CommandContext, previewOnly: boolean) => {
    const { process, ...facts } = await bind(ctx, true, previewOnly),
      { work: _, ...input } = ctx.admission.input;
    return { ...facts, prepare: async () => ({ process, input: { ...input, previewOnly } }) };
  };
  const bindHeal = async (ctx: CommandContext, previewOnly: boolean) => {
    const { process, ...facts } = await bind(ctx, false, previewOnly),
      { work: _, ...input } = ctx.admission.input;
    return {
      ...facts,
      prepare: async () => ({
        process,
        input: {
          ...(await planned(ductsHealInputSchema.parse(input), () =>
            invokeBridge<DuctSnapshot>(bridge, targetOf(ctx), "ducts.snapshot", {}),
          )),
          previewOnly,
        },
      }),
    };
  };
  const bindFan = async (ctx: CommandContext, previewOnly: boolean) => {
    const { process, ...facts } = await bind(ctx, false, previewOnly),
      { work: _, ...input } = ctx.admission.input;
    return { ...facts, prepare: async () => ({ process, input: { ...input, previewOnly } }) };
  };
  const run = async (ctx: CommandContext, execution: ActionExecution, key: string) => {
    const p = execution.prepared as {
        process: z.infer<typeof nativeProcessSchema>;
        input: unknown;
      },
      target = targetOf(ctx);
    const value = await execution.step(
      "native",
      key,
      p.input,
      (id) => invokeBridge(bridge, target, key, p.input, id),
      { process: p.process },
    );
    return { value, target: { session: target.session, document: null } };
  };
  const runLosses = (ctx: CommandContext, execution: ActionExecution) =>
    run(ctx, execution, "ducts.apply");
  const runHeal = (ctx: CommandContext, execution: ActionExecution) =>
    run(ctx, execution, "ducts.heal");
  const runFan = (ctx: CommandContext, execution: ActionExecution) =>
    run(ctx, execution, "ducts.assign-fan");
  return {
    "ducts.preview-losses": command(commands["ducts.preview-losses"], prepared(losses(true)), {
      bind: (ctx) => bindLosses(ctx, true),
      run: runLosses,
    }),
    "ducts.apply-losses": command(commands["ducts.apply-losses"], prepared(losses(false)), {
      bind: (ctx) => bindLosses(ctx, false),
      run: runLosses,
    }),
    "ducts.preview-heal": command(commands["ducts.preview-heal"], prepared(heal(true)), {
      bind: (ctx) => bindHeal(ctx, true),
      run: runHeal,
    }),
    "ducts.apply-heal": command(commands["ducts.apply-heal"], prepared(heal(false)), {
      bind: (ctx) => bindHeal(ctx, false),
      run: runHeal,
    }),
    "ducts.preview-assign-fan": command(commands["ducts.preview-assign-fan"], prepared(fan(true)), {
      bind: (ctx) => bindFan(ctx, true),
      run: runFan,
    }),
    "ducts.apply-assign-fan": command(commands["ducts.apply-assign-fan"], prepared(fan(false)), {
      bind: (ctx) => bindFan(ctx, false),
      run: runFan,
    }),
  };
}
