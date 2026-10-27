import { afterEach, expect, test, vi } from "vite-plus/test";
import { RunConsents, WRITE_COUNTDOWN_MS, type ConsentEvent } from "../src/run-consent.ts";
import type { Origin, RunRef } from "@pe/agent-contracts";

const ref = (turn: string, thread = "thread"): RunRef => ({ thread, turn });
const origin = (run: RunRef, root = run): Origin => ({
  caller: { kind: "pea", context: "minted", thread: run.thread, run, root },
  run,
  root,
});
const footprint = [{ kind: "file" as const, path: "C:/user/a.json" }];
afterEach(() => vi.useRealTimers());

test("concurrent first writes share one durable decision, deadline and idempotent answers", async () => {
  vi.useFakeTimers();
  const events: ConsentEvent[] = [],
    runs = new RunConsents((_, e) => events.push(e)),
    run = ref("1");
  runs.open(run);
  const a = runs.authorize(origin(run), "a", footprint),
    b = runs.authorize(origin(run), "b", footprint);
  const ask = events.find((e) => e.kind === "permission_request")!;
  expect(events.filter((e) => e.kind === "permission_request")).toHaveLength(1);
  expect(ask).toMatchObject({
    scope: "run",
    deadline: new Date(Date.now() + WRITE_COUNTDOWN_MS).toISOString(),
  });
  await vi.advanceTimersByTimeAsync(WRITE_COUNTDOWN_MS);
  expect(await a).toEqual(await b);
  expect(await a).toMatchObject({ run, decision: { by: "deadline", id: ask.requestId } });
  expect(runs.decide(run.thread, ask.requestId, "stop_writes")).toBe(true);
  expect(await runs.authorize(origin(run), "c", footprint)).toEqual(await a);
  runs.closeAll();
});

test("root and delegated children share approval and Stop, independent tasks do not", async () => {
  const events: ConsentEvent[] = [],
    runs = new RunConsents((_, e) => events.push(e));
  const root = ref("1"),
    child = ref("c", "child"),
    independent = ref("i", "independent");
  runs.open(root);
  runs.open(child, root);
  runs.open(independent);
  const a = runs.authorize(origin(root), "a", footprint),
    b = runs.authorize(origin(child, root), "b", footprint);
  const ask = events.find((e) => e.kind === "permission_request")!;
  runs.decide(root.thread, ask.requestId, "allow_now");
  expect(await a).toEqual(await b);
  const c = runs.authorize(origin(independent), "c", footprint);
  expect(events.filter((e) => e.kind === "permission_request")).toHaveLength(2);
  runs.close(root, "stopped");
  expect(() => runs.checkpoint(origin(child, root), null)).toThrow("consent.stopped");
  runs.close(independent, "completed");
  await expect(c).rejects.toThrow("consent.stopped");
  runs.closeAll();
});

test("normal completion closes new admission, preserves authorized continuation, cancels unapproved waits", async () => {
  const events: ConsentEvent[] = [],
    runs = new RunConsents((_, e) => events.push(e));
  const one = ref("one"),
    two = ref("two");
  runs.open(one);
  const approved = runs.authorize(origin(one), "a", footprint);
  const ask = events.find((e) => e.kind === "permission_request")!;
  runs.decide(one.thread, ask.requestId, "allow_now");
  const consent = await approved;
  runs.close(one, "completed");
  expect(() => runs.checkpoint(origin(one), consent)).not.toThrow();
  await expect(runs.authorize(origin(one), "late", footprint)).rejects.toThrow("run.closed");
  runs.open(two);
  const waiting = runs.authorize(origin(two), "waiting", footprint);
  runs.close(two, "completed");
  await expect(waiting).rejects.toThrow("consent.stopped");
  expect(() => new RunConsents(() => {}).checkpoint(origin(one), consent)).toThrow("run.closed");
  runs.closeAll();
});

test("an unscoped process cannot acquire the next run and native presses need no countdown", async () => {
  const events: ConsentEvent[] = [],
    runs = new RunConsents((_, e) => events.push(e));
  runs.open(ref("old"));
  runs.close(ref("old"), "completed");
  runs.open(ref("new"));
  await expect(runs.authorize(origin(ref("old")), "old-delayed", footprint)).rejects.toThrow(
    "run.closed",
  );
  await expect(
    runs.authorize(
      { caller: { kind: "pea", context: "spawn", thread: "thread" }, run: null, root: null },
      "unscoped",
      footprint,
    ),
  ).rejects.toThrow("run.none");
  expect(
    await runs.authorize(
      { caller: { kind: "human", via: "local" }, run: null, root: null },
      "press",
      footprint,
    ),
  ).toEqual({ by: "press" });
  expect(events.filter((e) => e.kind === "permission_request")).toHaveLength(0);
  runs.closeAll();
});
