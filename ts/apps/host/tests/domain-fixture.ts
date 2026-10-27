import { Effect } from "effect";
import { z } from "zod";
import { actionAdmissionSchema, type ActionReceipt } from "@pe/agent-contracts";
import { ActionJournal, type ActionExecution, type Crossing } from "../src/action-journal.ts";
import { familyExecutors, type FamilyActionDependencies } from "../src/family-actions.ts";
import { instancesExecutors, type InstancesActionDependencies } from "../src/instances-actions.ts";
import { commandReads } from "../src/command-reads.ts";
import type { CommandFactory } from "../src/command-executor.ts";
import type { RevitBridge } from "../src/bridge.ts";
import type { TakeoffCaptures } from "../src/takeoff-captures.ts";

const emptyBridge = { list: Effect.succeed([]) } as unknown as RevitBridge["Service"];

export function afterDomainBind(owner: ActionJournal, change: () => void) {
  const invoke = owner.invoke.bind(owner);
  owner.invoke = (admission, crossing, factory, resume) =>
    invoke(
      admission,
      crossing,
      async (context) => {
        const executor = await factory(context);
        return {
          ...executor,
          bind: async (current) => {
            const binding = await executor.bind(current);
            change();
            return binding;
          },
        };
      },
      resume,
    );
}
const configure = (
  owner: ActionJournal,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies,
  factories: Record<string, CommandFactory>,
) => {
  owner.configureCommands(commandReads(bridge, deps), (key) => {
    const factory = factories[key];
    if (!factory) throw Error(`Fixture has no executor for ${key}`);
    return factory;
  });
};

export function invokeFamily(
  raw: unknown,
  crossing: Crossing,
  owner: ActionJournal,
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies = {},
  resume = false,
) {
  const admission = actionAdmissionSchema.parse(raw);
  const factories = familyExecutors(captures, bridge, deps);
  configure(owner, bridge, deps, factories);
  return owner.invoke(admission, crossing, factories[admission.key]!, resume);
}

export function invokeInstances(
  raw: unknown,
  crossing: Crossing,
  owner: ActionJournal,
  deps: InstancesActionDependencies = {},
  resume = false,
) {
  const admission = actionAdmissionSchema.parse(raw);
  const factories = instancesExecutors(deps);
  configure(owner, emptyBridge, deps, factories);
  return owner.invoke(admission, crossing, factories[admission.key]!, resume);
}

export function recoverInstances(
  id: string,
  owner: ActionJournal,
  deps: InstancesActionDependencies = {},
) {
  configure(owner, emptyBridge, deps, instancesExecutors(deps));
  return owner.recover(id);
}

/** Seed an independent durable witness without a Revit process or filesystem effect. */
export function fixtureAction(
  owner: ActionJournal,
  raw: Record<string, unknown>,
  prepare: () => Promise<unknown>,
  run: (execution: ActionExecution) => Promise<unknown>,
  resume = false,
): Promise<ActionReceipt> {
  const { caller, basis, effects = [], consumes = [], ...intent } = raw;
  const admission = actionAdmissionSchema.parse(intent);
  return owner.invoke(
    admission,
    { caller, basis } as Crossing,
    () => ({
      definition: {
        says: "Fixture witness",
        needs: "nothing",
        effect: "query",
        dirties: [],
        input: z.record(z.string(), z.unknown()),
      },
      bind: async () => ({ effects, consumes }) as never,
      prepared: z.unknown(),
      prepare,
      run: (_context, execution) => run(execution),
    }),
    resume,
  );
}
