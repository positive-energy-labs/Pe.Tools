import { z } from "zod";
import type { Command, WorkPath } from "@pe/agent-contracts";
import type { CommandExecutor } from "./command-executor.ts";

export interface PodOperation {
  key: string;
  definition: Command;
  input(input: Record<string, unknown>): Record<string, unknown>;
  retires?: (result: unknown) => readonly WorkPath[];
}
const admitted = new WeakMap<CommandExecutor, PodOperation>();
/** Pods declare adaptation; this owner alone binds and dispatches the sealed native input. */
export function podExecutor(declaration: PodOperation, native: CommandExecutor): CommandExecutor {
  const op = Object.freeze({ ...declaration });
  const prepared = z.object({ input: z.record(z.string(), z.unknown()), value: z.unknown() });
  const boundary = (op.definition as Command & { writeBoundary?: { preview(request: unknown): unknown } }).writeBoundary;
  // The review shows the exact native payload, not the gateway's process/recovery preparation.
  if (boundary) boundary.preview = request => prepared.parse(request).input;
  const executor: CommandExecutor = {
    definition: op.definition,
    retires: op.retires,
    prepared,
    async bind(ctx) {
      if (op.definition.effect === "query") throw Error("Pod reads require /call, never the mutation gateway");
      const input = structuredClone(op.input(ctx.admission.input));
      const bound = await native.bind({ ...ctx, admission: { ...ctx.admission, input } });
      return { ...bound, prepare: async () => ({ input, value: native.prepared.parse(await bound.prepare?.()) }) };
    },
    async run(ctx, execution) {
      const p = prepared.parse(execution.prepared);
      return native.run({ ...ctx, admission: { ...ctx.admission, input: p.input } }, { ...execution, prepared: p.value });
    },
    recover: native.recover ? (step, raw, target) => native.recover!(step, prepared.parse(raw).value, target) : undefined,
  };
  admitted.set(executor, op);
  return Object.freeze(executor);
}
export const podOperationBinding = (executor: CommandExecutor) => admitted.get(executor);
