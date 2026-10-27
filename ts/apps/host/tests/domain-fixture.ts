import { Effect } from "effect";
import {
  actionAdmissionSchema,
  type ActionReceipt,
  type Consumed,
  type Footprint,
} from "@pe/agent-contracts";
import { ActionJournal, type ActionExecution, type Crossing } from "../src/action-journal.ts";
import { familyExecutors, type FamilyActionDependencies } from "../src/family-actions.ts";
import { instancesExecutors, type InstancesActionDependencies } from "../src/instances-actions.ts";
import { commandResources } from "../src/command-reads.ts";
import type { CommandExecutor } from "../src/command-executor.ts";
import { readNativeReceipt } from "../src/native-receipts.ts";
import type { RevitBridge } from "../src/bridge.ts";
import type { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { fixtureCommand } from "./command-fixture.ts";

const emptyBridge = { list: Effect.succeed([]) } as unknown as RevitBridge["Service"];
const faults = new WeakMap<ActionJournal, () => void>();
type Runtime = {
  bridge: RevitBridge["Service"];
  deps: FamilyActionDependencies;
  kind: "family" | "instances" | "witness";
};
const runtimes = new WeakMap<ActionJournal, Runtime>();

/** Fault injection wraps the stable bind hook, never admission or executor resolution. */
export function afterDomainBind(owner: ActionJournal, change: () => void) {
  faults.set(owner, change);
}

function configure(
  owner: ActionJournal,
  runtime: Runtime,
  entries: () => Record<string, CommandExecutor>,
) {
  const prior = runtimes.get(owner);
  if (prior) {
    if (
      prior.kind !== runtime.kind ||
      prior.bridge !== runtime.bridge ||
      prior.deps.workspace !== runtime.deps.workspace ||
      prior.deps.sdk !== runtime.deps.sdk ||
      prior.deps.podsRoot !== runtime.deps.podsRoot
    )
      throw Error(
        "A domain fixture cannot replace its bound bridge, Work or SDK; construct a new owner",
      );
    return;
  }
  const executors = entries();
  for (const [key, entry] of Object.entries(executors)) {
    executors[key] = {
      ...entry,
      bind: async (context) => {
        const binding = await entry.bind(context);
        faults.get(owner)?.();
        return binding;
      },
      recover:
        entry.recover ??
        ((step) => {
          if (!step.process) throw Error("No exact native process was captured for this step");
          return readNativeReceipt(step, step.process, runtime.deps.sdk);
        }),
    };
  }
  owner.bindCommands({
    ...commandResources(
      runtime.bridge,
      runtime.deps,
      async (id) => (await owner.list(undefined, id))[0],
    ),
    resolve: (key) => {
      const entry = executors[key];
      if (!entry) throw Error(`Fixture has no executor for ${key}`);
      return entry;
    },
  });
  runtimes.set(owner, runtime);
}

/** Dedicated witnesses are declared before the runtime binds; real preparation schemas stay intact. */
export function bindInstancesFixture(
  owner: ActionJournal,
  deps: InstancesActionDependencies,
  witnesses: Partial<
    Record<keyof ReturnType<typeof instancesExecutors>, Pick<CommandExecutor, "bind" | "run">>
  > = {},
) {
  configure(owner, { kind: "instances", bridge: emptyBridge, deps }, () => {
    const entries = instancesExecutors(deps);
    for (const [key, witness] of Object.entries(witnesses)) {
      const name = key as keyof typeof entries;
      entries[name] = { ...entries[name], ...witness };
    }
    return entries;
  });
}

export function invokeFamily(
  raw: unknown,
  crossing: Crossing,
  owner: ActionJournal,
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies = {},
  resume = false,
) {
  configure(owner, { kind: "family", bridge, deps }, () => familyExecutors(captures, bridge, deps));
  return owner.invoke(actionAdmissionSchema.parse(raw), crossing, resume);
}

export function invokeInstances(
  raw: unknown,
  crossing: Crossing,
  owner: ActionJournal,
  deps: InstancesActionDependencies = {},
  resume = false,
) {
  bindInstancesFixture(owner, deps);
  return owner.invoke(actionAdmissionSchema.parse(raw), crossing, resume);
}

export function recoverInstances(
  id: string,
  owner: ActionJournal,
  deps: InstancesActionDependencies = {},
) {
  bindInstancesFixture(owner, deps);
  return owner.recover(id);
}

/** A separate seed runtime executes this durable witness before a real domain owner is constructed. */
export function fixtureAction(
  owner: ActionJournal,
  raw: Record<string, unknown>,
  prepare: () => Promise<unknown>,
  run: (execution: ActionExecution) => Promise<unknown>,
  resume = false,
): Promise<ActionReceipt> {
  const { caller, basis, effects = [], consumes = [], ...intent } = raw;
  const admission = actionAdmissionSchema.parse(intent);
  configure(owner, { kind: "witness", bridge: emptyBridge, deps: {} }, () => ({
    [admission.key]: fixtureCommand(effects as Footprint, prepare, run, consumes as Consumed[]),
  }));
  return owner.invoke(admission, { caller, basis } as Crossing, resume);
}
