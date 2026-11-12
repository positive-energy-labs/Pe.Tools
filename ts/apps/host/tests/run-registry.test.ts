import { Context, Effect, Exit, Layer, Scope } from "effect";
import { expect } from "vite-plus/test";
import { RunRegistry } from "../src/run-registry.ts";
import { captureLogs, effectTest } from "./effect-test.ts";

effectTest("run changes are synchronous, isolate subscribers, and close with their scope", () =>
  Effect.gen(function* () {
    const logs = captureLogs();
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(RunRegistry.layer, scope).pipe(
      Effect.provide(logs.layer),
    );
    const runs = Context.get(context, RunRegistry);
    const ref = { thread: "thread", turn: "turn" };
    const origin = { caller: { kind: "pea" as const, thread: ref.thread, context: "test" }, run: ref, root: ref };
    let notified = 0;
    runs.subscribe(() => { throw Error("subscriber failed"); });
    runs.subscribe(() => { notified++; });
    runs.open(ref);
    expect(notified).toBe(1);
    expect(() => runs.assertOpen(origin)).not.toThrow();
    runs.close(ref, "completed");
    expect(() => runs.assertOpen(origin)).toThrow("run.closed");
    expect(() => runs.checkpoint(origin)).not.toThrow();
    runs.revoke(ref.thread);
    expect(() => runs.checkpoint(origin)).toThrow("run.stopped");
    expect(() => runs.open(ref)).toThrow("cannot be reopened");
    const next = { thread: ref.thread, turn: "next" };
    runs.open(next);
    yield* Scope.close(scope, Exit.void);
    expect(() => runs.checkpoint({ ...origin, run: next, root: next })).toThrow("run.stopped");
    expect(notified).toBe(5);
    expect(logs.lines).toHaveLength(5);
    expect(String(logs.lines[0]?.message)).toContain("subscriber failed");
  }),
);
