import { z } from "zod";
import type { ActionAdmission, Consumed, Claim, Footprint } from "@pe/agent-contracts";
import type { ActionExecution, ActionJournal, Crossing } from "../src/action-journal.ts";
import type { CommandContext, CommandExecutor, CommandResources } from "../src/command-executor.ts";

const fixtures = new WeakMap<ActionJournal, Map<string, CommandExecutor>>();
/** One environment and one key lookup per test runtime. Existing entries never get replaced. */
export function bindFixtureCommands(
  owner: ActionJournal,
  resources: Partial<CommandResources> = {},
) {
  if (fixtures.has(owner)) throw Error("Fixture commands already composed");
  const entries = new Map<string, CommandExecutor>();
  owner.bindCommands({
    probe: async () => {
      throw Error("Unexpected dependency probe");
    },
    ...resources,
    resolve: (key) => {
      const entry = entries.get(key);
      if (!entry) throw Error(`Fixture has no command '${key}'`);
      return entry;
    },
  });
  fixtures.set(owner, entries);
  return entries;
}

export function registerFixtureCommand(owner: ActionJournal, key: string, entry: CommandExecutor) {
  const entries = fixtures.get(owner) ?? bindFixtureCommands(owner);
  if (!entries.has(key)) entries.set(key, entry);
  return entries.get(key)!;
}

export function invokeFixtureCommand(
  owner: ActionJournal,
  admission: ActionAdmission,
  crossing: Crossing,
  entry: CommandExecutor,
  resume = false,
) {
  registerFixtureCommand(owner, admission.key, entry);
  return owner.invoke(admission, crossing, resume);
}

/** A test's domain implementation. Production consumers use the registered executor directly. */
export const fixtureCommand = (
  effects: Footprint | ((context: CommandContext) => Footprint),
  prepare: () => Promise<unknown>,
  run: (execution: ActionExecution, context: CommandContext) => Promise<unknown>,
  consumes: Consumed[] = [],
  claims: Claim[] = [],
  controls: Pick<CommandExecutor, "recover" | "cancel"> = {},
): CommandExecutor => ({
  definition: (context) => ({
    says: "Fixture command",
    needs: "nothing",
    target: () => context.admission.target,
    effect: typeof effects === "function" || effects.length ? "command" : "query",
    // These probes exercise resource trust after capability eligibility has admitted the caller.
    principal: ["human", "pea", "page", "external-mcp"],
    dirties: [],
    input: z.record(z.string(), z.unknown()),
  }),
  bind: async (context) => ({
    effects: typeof effects === "function" ? effects(context) : effects,
    consumes,
    claims,
    prepare,
  }),
  prepared: z.unknown(),
  run: (context, execution) => run(execution, context),
  ...controls,
});

export function invokeCommand(
  owner: ActionJournal,
  raw: ActionAdmission &
    Crossing & { effects?: Footprint; consumes?: Consumed[]; claims?: Claim[] },
  prepare: () => Promise<unknown>,
  run: (execution: ActionExecution, context: CommandContext) => Promise<unknown>,
  resume = false,
  controls: Pick<CommandExecutor, "recover" | "cancel"> = {},
) {
  const { caller, basis, effects, consumes = [], claims = [], ...admission } = raw;
  const declared =
    effects ??
    (({ admission }: CommandContext): Footprint =>
      admission.target.kind === "document"
        ? [{ kind: "document", ref: admission.target.ref }]
        : admission.target.kind === "session"
          ? [{ kind: "session", session: admission.target.session }]
          : []);
  return invokeFixtureCommand(
    owner,
    admission,
    { caller, basis },
    fixtureCommand(declared, prepare, run, consumes, claims, controls),
    resume,
  );
}
