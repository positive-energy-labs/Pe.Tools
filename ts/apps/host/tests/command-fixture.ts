import { z } from "zod";
import type { ActionAdmission, Consumed, Claim, Footprint } from "@pe/agent-contracts";
import type { ActionExecution, ActionJournal, Crossing } from "../src/action-journal.ts";
import type { CommandFactory } from "../src/command-executor.ts";

/** A test's domain implementation. Production consumers use the registered executor directly. */
export const fixtureCommand =
  (
    effects: Footprint,
    prepare: () => Promise<unknown>,
    run: (execution: ActionExecution) => Promise<unknown>,
    consumes: Consumed[] = [],
    claims: Claim[] = [],
  ): CommandFactory =>
  ({ admission }) => ({
    definition: {
      says: admission.key,
      needs: "nothing",
      target: () => admission.target,
      effect: effects.length ? "command" : "query",
      dirties: [],
      input: z.record(z.string(), z.unknown()),
    },
    bind: async () => ({ effects, consumes, claims }),
    prepared: z.unknown(),
    prepare,
    run: (_context, execution) => run(execution),
  });

export function invokeCommand(
  owner: ActionJournal,
  raw: ActionAdmission &
    Crossing & { effects?: Footprint; consumes?: Consumed[]; claims?: Claim[] },
  prepare: () => Promise<unknown>,
  run: (execution: ActionExecution) => Promise<unknown>,
  resume = false,
) {
  const { caller, basis, effects, consumes = [], claims = [], ...admission } = raw;
  const declared =
    effects ??
    (admission.target.kind === "document"
      ? [{ kind: "document" as const, ref: admission.target.ref }]
      : admission.target.kind === "session"
        ? [{ kind: "session" as const, session: admission.target.session }]
        : []);
  return owner.invoke(
    admission,
    { caller, basis },
    fixtureCommand(declared, prepare, run, consumes, claims),
    resume,
  );
}
