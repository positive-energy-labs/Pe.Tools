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
  expect(ask.toolCall.title).toContain("C:/user/a.json");
  await vi.advanceTimersByTimeAsync(WRITE_COUNTDOWN_MS);
  expect(await a).toEqual(await b);
  expect(await a).toMatchObject({ run, decision: { by: "deadline", id: ask.requestId } });
  expect(runs.decide(run.thread, ask.requestId, "stop_writes")).toBe(true);
  expect(await runs.authorize(origin(run), "c", footprint)).toEqual(await a);
  runs.closeAll();
});

test("a completed child cancels its unapproved wait without ending its root decision", async () => {
  const events: ConsentEvent[] = [],
    runs = new RunConsents((_, event) => events.push(event));
  const root = ref("root"),
    child = ref("child", "child-thread");
  runs.open(root);
  runs.open(child, root);
  const rootWait = runs.authorize(origin(root), "root-command", footprint);
  const childWait = runs.authorize(origin(child, root), "child-command", footprint);
  const childResult = childWait.then(
    () => "allowed",
    () => "cancelled",
  );
  runs.close(child, "completed");
  expect(() => runs.checkpoint(origin(child, root), null)).toThrow("run.closed");
  const ask = events.find((event) => event.kind === "permission_request")!;
  runs.decide(root.thread, ask.requestId, "allow_now");
  expect(await childResult).toBe("cancelled");
  expect(await rootWait).toMatchObject({ run: root, decision: { by: "human" } });
  expect(events.filter((event) => event.kind === "permission_request")).toHaveLength(1);
  runs.closeAll();
});

test("the first command names every effect; other documents share the original deadline", async () => {
  const events: ConsentEvent[] = [],
    runs = new RunConsents(
      (_, event) => events.push(event),
      () => "Office.rvt",
    );
  const run = ref("footprint");
  runs.open(run);
  const first = runs.authorize(origin(run), "first", [
    { kind: "document", ref: { session: "revit-1", openId: "doc-1" } },
    { kind: "session", session: "revit-1" },
    { kind: "member", pod: "tools", path: "settings/design.json" },
    { kind: "directory", path: "C:/installation" },
    { kind: "publication", page: "page:@pages/report" },
    { kind: "receipt", pod: "tools", path: "runs/receipt.json" },
  ]);
  const second = runs.authorize(origin(run), "second", [
    { kind: "document", ref: { session: "revit-2", openId: "doc-2" } },
  ]);
  const asks = events.filter((event) => event.kind === "permission_request");
  expect(asks).toHaveLength(1);
  expect(asks[0]!.toolCall.title).toBe(
    "First write: document Office.rvt (revit-1/doc-1), session revit-1, member tools/settings/design.json, directory C:/installation, publication page:@pages/report. Then all writes for this turn.",
  );
  runs.decide(run.thread, asks[0]!.requestId, "allow_now");
  expect(await first).toEqual(await second);
  runs.closeAll();
});

test("approved child commands may finish after normal child and root completion", async () => {
  const events: ConsentEvent[] = [],
    runs = new RunConsents((_, event) => events.push(event));
  const root = ref("root"),
    child = ref("child", "child-thread");
  runs.open(root);
  runs.open(child, root);
  const waiting = runs.authorize(origin(child, root), "child", footprint);
  const ask = events.find((event) => event.kind === "permission_request")!;
  runs.decide(root.thread, ask.requestId, "allow_now");
  const consent = await waiting;
  runs.close(child, "completed");
  runs.close(root, "completed");
  expect(() => runs.checkpoint(origin(child, root), consent)).not.toThrow();
  await expect(runs.authorize(origin(child, root), "late", footprint)).rejects.toThrow(
    "run.closed",
  );
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
