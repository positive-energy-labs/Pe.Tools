import { NodeCrypto } from "@effect/platform-node";
import { Context, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vite-plus/test";
import type { Origin, RunRef } from "@pe/agent-contracts";
import {
  RunConsents,
  type ConsentEvent,
  type ConsentSink,
  ConsentPersistFailed,
  ConsentRefused,
} from "../src/run-consent.ts";
import { effectTest } from "./effect-test.ts";

// ADR 0027 rule 11 on Clock: TestClock drives the window, no wall-clock wait. Every test's runs
// live in the test's scope, so its close interrupts open windows even when an assertion fails.
const origin = (run: RunRef): Origin => ({
  caller: { kind: "pea", context: "minted", thread: run.thread, run, root: run },
  run,
  root: run,
});
const footprint = [{ kind: "file" as const, path: "C:/user/a.json" }];
const one: RunRef = { thread: "thread", turn: "1" };

const consents = (sink: Partial<ConsentSink> = {}) =>
  Effect.gen(function* () {
    const runs = Context.get(
      yield* Layer.build(RunConsents.layer.pipe(Layer.provide(NodeCrypto.layer))),
      RunConsents,
    );
    const events: ConsentEvent[] = [];
    runs.attach({ emit: (_, e) => events.push(e), persist: () => {}, autoApprove: () => true, ...sink });
    return { runs, events };
  });

/** Open `run` and start one write that waits on its consent. */
const ask = (runs: RunConsents["Service"], events: ConsentEvent[], run = one, id = "a") =>
  Effect.gen(function* () {
    yield* runs.open(run);
    const answer = yield* Effect.forkScoped(runs.authorize(origin(run), id, footprint));
    yield* Effect.yieldNow;
    const request = events.findLast((e) => e.kind === "permission_request")!;
    return { answer, request };
  });

effectTest("consent.window: auto-approve fires at the deadline under TestClock", () =>
  Effect.gen(function* () {
    const { runs, events } = yield* consents();
    const { answer, request } = yield* ask(runs, events);
    yield* TestClock.adjust("59 seconds");
    expect(runs.commandWindow("a")).toMatchObject({ requestId: request.requestId });
    yield* TestClock.adjust("1 second");
    expect(yield* Fiber.join(answer)).toMatchObject({
      run: one,
      decision: { by: "deadline", id: request.requestId },
    });
  }),
);

effectTest("consent.window: Reject before the deadline cancels, and the deadline never fires", () =>
  Effect.gen(function* () {
    const { runs, events } = yield* consents();
    const { answer, request } = yield* ask(runs, events);
    yield* TestClock.adjust("30 seconds");
    expect(yield* runs.decide(one.thread, request.requestId, "stop_writes")).toBe(true);
    const exit = yield* Fiber.await(answer);
    expect(Exit.findErrorOption(exit)).toMatchObject({
      value: { _tag: "ConsentRefused", message: "rejected by you" },
    });
    yield* TestClock.adjust("60 seconds");
    expect(events.filter((e) => e.kind === "permission_resolved")).toEqual([
      { kind: "permission_resolved", turnId: "1", requestId: request.requestId, by: "cancel" },
    ]);
  }),
);

effectTest("consent.window: the deadline the UI reads is the instant the window approves", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-02T12:00:00.000Z"));
    const { runs, events } = yield* consents();
    const { answer, request } = yield* ask(runs, events);
    expect(request.deadline).toBe("2026-11-02T12:01:00.000Z");
    expect(runs.commandWindow("a")?.deadline).toBe(request.deadline);
    yield* TestClock.setTime(Date.parse(request.deadline!) - 1);
    expect(answer.pollUnsafe()).toBeUndefined();
    yield* TestClock.setTime(Date.parse(request.deadline!));
    expect(yield* Fiber.join(answer)).toMatchObject({ decision: { by: "deadline" } });
  }),
);

const failing = () => {
  throw Error("disk full");
};

effectTest("consent.settle: a grant the record refused fails every waiter, never succeeds", () =>
  Effect.gen(function* () {
    const { runs, events } = yield* consents({ persist: failing });
    const { answer, request } = yield* ask(runs, events);
    const second = yield* Effect.forkScoped(runs.authorize(origin(one), "b", footprint));
    yield* Effect.yieldNow;
    const decided = yield* Effect.exit(runs.decide(one.thread, request.requestId, "allow_now"));
    expect(Exit.findErrorOption(decided)).toMatchObject({ value: { _tag: "ConsentPersistFailed" } });
    for (const waiter of [answer, second])
      expect(Exit.findErrorOption(yield* Fiber.await(waiter)).pipe((e) => e._tag === "Some" && e.value))
        .toBeInstanceOf(ConsentPersistFailed);
    // A retry does not read as success: the ask is gone, the next write opens a fresh window.
    expect(yield* runs.decide(one.thread, request.requestId, "allow_now")).toBe(false);
    // The deadline of the failed window never approves behind the person's back.
    yield* TestClock.adjust("2 minutes");
    expect(events.some((e) => e.kind === "permission_resolved" && e.by === "deadline")).toBe(false);
  }),
);

effectTest("consent.settle: the deadline's grant failing to persist fails the waiter too", () =>
  Effect.gen(function* () {
    const { runs, events } = yield* consents({ persist: failing });
    const { answer } = yield* ask(runs, events);
    yield* TestClock.adjust("60 seconds");
    expect(Exit.isFailure(yield* Fiber.await(answer))).toBe(true);
    expect(runs.commandWindow("a")).toBeUndefined();
  }),
);

effectTest("consent.settle: Reject with a failing record still refuses, and reports the failure", () =>
  Effect.gen(function* () {
    const { runs, events } = yield* consents({ persist: failing });
    const { answer, request } = yield* ask(runs, events);
    const decided = yield* Effect.exit(runs.decide(one.thread, request.requestId, "stop_writes"));
    expect(Exit.findErrorOption(decided)).toMatchObject({ value: { _tag: "ConsentPersistFailed" } });
    expect(Exit.findErrorOption(yield* Fiber.await(answer))).toMatchObject({
      value: { _tag: "ConsentRefused", message: "rejected by you" },
    });
  }),
);

effectTest("consent.settle: closeAll with throwing record, transcript and listener ends every waiter", () =>
  Effect.gen(function* () {
    const { runs } = yield* consents({ persist: failing });
    const asks: ConsentEvent[] = [];
    runs.attach({
      emit: (_, e) => {
        asks.push(e);
        throw Error("transcript gone");
      },
      persist: failing,
      autoApprove: () => true,
    });
    runs.subscribe(() => {
      throw Error("listener gone");
    });
    const two: RunRef = { thread: "other", turn: "1" };
    const first = yield* ask(runs, asks, one);
    const second = yield* ask(runs, asks, two);
    yield* runs.revoke(two.thread).pipe(Effect.exit);
    yield* runs.closeAll.pipe(Effect.exit);
    for (const { answer } of [first, second]) {
      const error = Exit.findErrorOption(yield* Fiber.await(answer));
      expect(error._tag === "Some" && error.value).toBeInstanceOf(ConsentRefused);
    }
  }),
);

effectTest(
  "consent.waiter: interruption unregisters only its command and preserves auto-approval",
  () =>
    Effect.gen(function* () {
      const { runs, events } = yield* consents();
      const { answer, request } = yield* ask(runs, events);
      const second = yield* Effect.forkScoped(runs.authorize(origin(one), "b", footprint));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(answer);
      expect(runs.commandWindow("a")).toBeUndefined();
      expect(runs.commandWindow("b")).toMatchObject({
        requestId: request.requestId,
        deadline: request.deadline,
      });
      expect(events.findLast((event) => event.kind === "run_consent")).toMatchObject({
        consent: { state: "waiting", commands: ["b"], deadline: request.deadline },
      });
      yield* TestClock.adjust("60 seconds");
      expect(yield* Fiber.join(second)).toMatchObject({ decision: { by: "deadline" } });
    }),
);
