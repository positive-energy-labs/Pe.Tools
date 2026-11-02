import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vite-plus/test";
import type { Origin, RunRef } from "@pe/agent-contracts";
import { RunConsents, type ConsentEvent } from "../src/run-consent.ts";
import { effectTest } from "./effect-test.ts";

// ADR 0027 rule 11 on Clock: TestClock drives the window, no wall-clock wait.
const run: RunRef = { thread: "thread", turn: "1" };
const origin: Origin = {
  caller: { kind: "pea", context: "minted", thread: run.thread, run, root: run },
  run,
  root: run,
};
const footprint = [{ kind: "file" as const, path: "C:/user/a.json" }];

const openWindow = Effect.gen(function* () {
  const events: ConsentEvent[] = [];
  const runs = new RunConsents(
    (_, event) => events.push(event),
    undefined,
    () => true,
    () => {},
    yield* Effect.context<never>(),
  );
  runs.open(run);
  const answer = runs.authorize(origin, "a", footprint).then(
    (consent) => ({ consent }),
    (error: Error) => ({ error: error.message }),
  );
  const ask = events.find((event) => event.kind === "permission_request")!;
  return { events, runs, answer, ask };
});

effectTest("consent.window: auto-approve fires at the deadline under TestClock", () =>
  Effect.gen(function* () {
    const { runs, answer, ask } = yield* openWindow;
    yield* TestClock.adjust("59 seconds");
    expect(runs.commandWindow("a")).toMatchObject({ requestId: ask.requestId });
    yield* TestClock.adjust("1 second");
    expect(yield* Effect.promise(() => answer)).toMatchObject({
      consent: { run, decision: { by: "deadline", id: ask.requestId } },
    });
    runs.closeAll();
  }),
);

effectTest("consent.window: Reject before the deadline cancels, and the deadline never fires", () =>
  Effect.gen(function* () {
    const { events, runs, answer, ask } = yield* openWindow;
    yield* TestClock.adjust("30 seconds");
    expect(runs.decide(run.thread, ask.requestId, "stop_writes")).toBe(true);
    expect(yield* Effect.promise(() => answer)).toEqual({ error: "rejected by you" });
    yield* TestClock.adjust("60 seconds");
    expect(events.filter((e) => e.kind === "permission_resolved")).toEqual([
      { kind: "permission_resolved", turnId: "1", requestId: ask.requestId, by: "cancel" },
    ]);
  }),
);

effectTest("consent.window: the deadline the UI reads is the instant the window approves", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-02T12:00:00.000Z"));
    const { runs, answer, ask } = yield* openWindow;
    expect(ask.deadline).toBe("2026-11-02T12:01:00.000Z");
    expect(runs.commandWindow("a")?.deadline).toBe(ask.deadline);
    yield* TestClock.setTime(Date.parse(ask.deadline!) - 1);
    const pending = yield* Effect.promise(() => Promise.race([answer, Promise.resolve("open")]));
    expect(pending).toBe("open");
    yield* TestClock.setTime(Date.parse(ask.deadline!));
    expect(yield* Effect.promise(() => answer)).toMatchObject({
      consent: { decision: { by: "deadline" } },
    });
    runs.closeAll();
  }),
);
