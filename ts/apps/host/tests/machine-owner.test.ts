import { Context, Effect, Exit, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vite-plus/test";
import { MachineOwner, MachineRetired, unavailableShare, type MachineSources } from "../src/machine.ts";
import { unreadLeg } from "../src/update-reader.ts";
import { effectTest } from "./effect-test.ts";

const update = {
  plan: null,
  receipt: null,
  requestId: null,
  admittedPlanId: null,
  planLeg: unreadLeg(),
  receiptLeg: unreadLeg(),
  automatic: true,
};

/** Effect legs that count how many census passes read `sessions`. */
const counting = () => {
  const reads = { sessions: 0 };
  const sources: MachineSources = {
    targets: { targets: () => [], subscribe: () => () => {} },
    actions: async () => [],
    host: () => Effect.succeed({} as never),
    peers: () => Effect.succeed([]),
    sessions: () =>
      Effect.sync(() => {
        reads.sessions++;
        return [];
      }),
    documents: () => Effect.succeed({ state: "ok", documents: [] }),
    holdings: () => Effect.succeed(null),
    attachments: () => Effect.succeed([]),
    years: () => Effect.succeed([]),
    providers: async () => ({ providers: [] }),
    share: unavailableShare,
    update: {
      current: () => update,
      refresh: async () => update,
      apply: async () => update,
      announce: () => {},
      setAutomatic: async () => update,
      automaticPending: () => false,
    } as never,
  };
  return { reads, sources };
};

/** Let every forked fiber that is ready run. */
const settleFibers = Effect.repeat(Effect.yieldNow, { times: 20 });

effectTest("an observed owner polls once per period and closing its scope stops the poll", () =>
  Effect.gen(function* () {
    const { reads, sources } = counting();
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(MachineOwner.layer(sources, { periodMs: 5_000 }), scope);
    const owner = Context.get(context, MachineOwner);

    // Nobody observes: time passes and nothing reads.
    yield* TestClock.adjust("20 seconds");
    yield* settleFibers;
    expect(reads.sessions).toBe(0);

    // The first observer reads at once, then once per period.
    owner.observe(() => {});
    yield* settleFibers;
    expect(reads.sessions).toBe(1);
    for (const polls of [2, 3, 4]) {
      yield* TestClock.adjust("5 seconds");
      yield* settleFibers;
      expect(reads.sessions).toBe(polls);
    }

    // Closing the scope retires the owner: no tick reads again, and a mutation's fresh read refuses.
    yield* Scope.close(scope, Exit.void);
    yield* TestClock.adjust("60 seconds");
    yield* settleFibers;
    expect(reads.sessions).toBe(4);
    const refused = yield* Effect.flip(owner.fresh);
    expect(refused).toBeInstanceOf(MachineRetired);
  }),
);
