/**
 * /ducts verbs on the host: `ducts.preview-losses` and `ducts.apply-losses` are one native op, `ducts.apply`,
 * `ducts.preview-heal` and `ducts.apply-heal` are `ducts.heal`, and `ducts.preview-assign-fan` and
 * `ducts.apply-assign-fan` are `ducts.assign-fan`, each sent with `previewOnly` true or false. The web builds the whole write list from the person's
 * staged cells and Pe's own lookup; the host admits it against the exact document lifetime and
 * process incarnation, journals the native step, and never reads or rewrites the Work.
 */
import {
  ductsActions,
  commands,
  commandTool,
  editableCells,
  type WorkHandle,
  type Consumed,
  nativeProcessSchema,
  type DuctsActionKey,
  type DuctsHealInput,
} from "@pe/agent-contracts";
import { healPlan, healRequestGroup } from "@pe/ducts-domain/heal";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { z } from "zod";
import { BridgeError, invokeBridge, type RevitBridge } from "./bridge.ts";
import type { CommandContext, CommandFactory } from "./command-executor.ts";
import { lifetime } from "./family-actions.ts";
import { type SdkReceiptReader } from "./native-receipts.ts";

const preparedDuctsSchema = z.strictObject({
  process: nativeProcessSchema,
  op: z.enum(["ducts.apply", "ducts.heal", "ducts.assign-fan"]),
  input: z.record(z.string(), z.unknown()),
});

/** Each verb's native op and whether it only previews. */
const NATIVE: Record<
  DuctsActionKey,
  { op: "ducts.apply" | "ducts.heal" | "ducts.assign-fan"; previewOnly: boolean }
> = {
  "ducts.preview-losses": { op: "ducts.apply", previewOnly: true },
  "ducts.apply-losses": { op: "ducts.apply", previewOnly: false },
  "ducts.preview-heal": { op: "ducts.heal", previewOnly: true },
  "ducts.apply-heal": { op: "ducts.heal", previewOnly: false },
  "ducts.preview-assign-fan": { op: "ducts.assign-fan", previewOnly: true },
  "ducts.apply-assign-fan": { op: "ducts.assign-fan", previewOnly: false },
};

/**
 * A heal group sent without items is planned here from a fresh snapshot with the route's own
 * classifier (`heal.ts`), so an agent can name a group; groups with items pass through untouched.
 */
async function planned(input: DuctsHealInput, read: () => Promise<DuctSnapshot>) {
  if (input.groups.every((g) => g.items)) return input;
  const plan = healPlan(await read());
  return {
    groups: input.groups.map((g) => {
      if (g.items) return g;
      const found = plan.groups.find((p) => p.group === g.group);
      if (!found)
        throw refused(`Group ${g.group} has nothing to heal (or no such group in the snapshot)`);
      return healRequestGroup(found);
    }),
  };
}
const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });

export function ductsExecutors(
  bridge: RevitBridge["Service"],
  deps: { sdk?: SdkReceiptReader } = {},
) {
  return Object.fromEntries(
    Object.keys(ductsActions).map((key) => [
      key,
      (ctx: CommandContext) => {
        const { admission } = ctx;
        const definition = commands[key as DuctsActionKey];
        const { work, ...input } = admission.input;
        const handle = work as WorkHandle | undefined;
        if (admission.target.kind !== "document") throw refused("Exact document target required");
        const target = admission.target.ref;
        const native = NATIVE[key as DuctsActionKey];
        let process: z.infer<typeof nativeProcessSchema>;
        return {
          definition,
          prepared: preparedDuctsSchema,
          bind: async () => {
            ({ process } = await lifetime(bridge, target, "project", deps));
            const consumes: Consumed[] = [
              { kind: "incarnation", target: admission.target, process },
            ];
            if (handle) {
              const frozen = await ctx.read.work(handle, "ducts");
              const paths =
                native.op === "ducts.apply"
                  ? editableCells(frozen.doc, commandTool(key)?.work?.editable ?? []).flatMap(
                      ({ path, cell }) =>
                        cell.edit &&
                        !["systemColours", "claims", "subject"].includes(String(path[0]))
                          ? [[...path, "edit"]]
                          : [],
                    )
                  : [];
              consumes.push({ kind: "work", handle, paths, snapshot: frozen.doc });
            }
            return {
              consumes,
              effects:
                definition.effect === "query" ? [] : [{ kind: "document" as const, ref: target }],
            };
          },
          prepare: async () => ({
            process,
            op: native.op,
            input: {
              ...(native.op === "ducts.heal"
                ? await planned(input as DuctsHealInput, async () => {
                    return invokeBridge<DuctSnapshot>(bridge, target, "ducts.snapshot", {});
                  })
                : input),
              previewOnly: native.previewOnly,
            },
          }),
          run: async (
            _ctx: CommandContext,
            execution: import("./action-journal.ts").ActionExecution,
          ) => {
            const prepared = execution.prepared as z.infer<typeof preparedDuctsSchema>;
            const value = await execution.step(
              "native",
              prepared.op,
              prepared.input,
              (requestId) => invokeBridge(bridge, target, prepared.op, prepared.input, requestId),
              prepared.process,
            );
            return { value, target: { session: target.session, document: null } };
          },
        };
      },
    ]),
  ) as Record<string, CommandFactory>;
}
