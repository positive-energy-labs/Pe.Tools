import { DispatchLimits } from "@pe/host-internal/dispatch";
import { bindActionDispatch } from "../src/action-dispatch.ts";
import { Cause, Effect, Exit, Fiber, Layer, Queue, Scope } from "effect";
import { TestClock } from "effect/testing";
import { expect, vi } from "vite-plus/test";
import type { BridgeFrame } from "@pe/host-contracts/contracts";
import { CANCEL_OPERATION_KEY, RevitBridgeLive, RevitProcessAlive } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import type { ActionJournal } from "../src/action-journal.ts";
import { effectTest } from "./effect-test.ts";

// The session line's law (ADR 0029 phase 3b; a PROVEN 7.6 GB regression class lives behind it):
// interrupting a waiter removes it and nothing else; op.cancel never takes a place in the line;
// the slot belongs to the process incarnation, not the socket, and is released only by Revit's
// answer to the running op or by process death. Only the socket and the pid probe are fake.

/** Event-loop turns, not time: lets queued fibers and journal promises run before a negative check. */
const turns = (n = 5) =>
  Effect.promise(async () => {
    for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
  });

const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

const response = (requestId: string) =>
  JSON.stringify({
    kind: "Response",
    response: {
      requestId,
      ok: true,
      statusCode: 200,
      payloadJson: "{}",
      metrics: {
        requestBytes: 0,
        responseBytes: 0,
        revitExecutionMs: 0,
        roundTripMs: 0,
        serializationMs: 0,
      },
    },
  });

const harness = Effect.gen(function* () {
  const life = { alive: true };
  const bridgeScope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(RevitBridgeLive, bridgeScope).pipe(
    Effect.provideService(RevitProcessAlive, () => life.alive),
  );
  /** One fake socket of Revit process 42; `registration` overrides fields of its Registration. */
  const socketOf = (registration: Record<string, unknown> = {}) =>
    Effect.gen(function* () {
      const { bridge, incoming, outgoing, connection, target } = yield* connectTestBridge(
        42,
        registration,
      ).pipe(Effect.provide(context));
      return {
        bridge,
        target,
        outgoing,
        /** The next Request frame this socket carries. */
        sent: Queue.take(outgoing).pipe(Effect.map((frame: BridgeFrame) => frame.request!)),
        answer: (requestId: string) => Queue.offer(incoming, response(requestId)),
        /** Any raw frame from Revit, for answers other than plain success. */
        frame: (raw: string) => Queue.offer(incoming, raw),
        /** Several frames in one socket batch: no fiber runs between them. */
        batch: (...raws: string[]) => Queue.offer(incoming, raws),
        close: Fiber.interrupt(connection),
      };
    });
  const socket = socketOf(); // the same incarnation every time
  const first = yield* socket;
  const call = (key: string, payload: unknown = {}, requestId?: string) =>
    Effect.forkScoped(
      first.bridge.invoke(key, payload, first.target.session, first.target.openId, requestId),
    );
  return { life, bridgeScope, socket, socketOf, call, ...first };
});

effectTest("interrupting a waiter never lets the one behind it overtake the running op", () =>
  Effect.gen(function* () {
    const { call, sent, answer, outgoing, socketOf } = yield* harness;
    const a = yield* call("test.a");
    const runningA = yield* sent;
    expect(runningA.operationKey).toBe("test.a");
    const other = yield* socketOf({ processId: 43 });
    const independent = yield* Effect.forkScoped(
      other.bridge.invoke("test.independent", {}, other.target.session),
    );
    const independentRequest = yield* other.sent;
    yield* other.answer(independentRequest.requestId);
    expect(Exit.isSuccess(yield* Fiber.await(independent))).toBe(true);
    const b = yield* call("test.b");
    yield* turns();
    const c = yield* call("test.c");
    yield* turns();
    yield* Fiber.interrupt(b);
    yield* turns();
    expect(yield* Queue.size(outgoing)).toBe(0); // C still waits: A holds the slot
    yield* answer(runningA.requestId);
    expect(Exit.isSuccess(yield* Fiber.await(a))).toBe(true);
    const next = yield* sent;
    expect(next.operationKey).toBe("test.c"); // B left; it is never sent
    yield* answer(next.requestId);
    expect(Exit.isSuccess(yield* Fiber.await(c))).toBe(true);
  }),
);

effectTest(
  "op.cancel reaches Revit while A runs, and its acceptance does not release A's slot",
  () =>
    Effect.gen(function* () {
      const { bridge, call, sent, answer, outgoing } = yield* harness;
      const a = yield* call("test.a");
      const runningA = yield* sent;
      const b = yield* call("test.b");
      yield* turns();
      const cancel = yield* Effect.forkScoped(
        bridge.invoke(CANCEL_OPERATION_KEY, { requestId: runningA.requestId }),
      );
      const cancelFrame = yield* sent;
      expect(cancelFrame.operationKey).toBe(CANCEL_OPERATION_KEY);
      expect(JSON.parse(cancelFrame.payloadJson ?? "{}")).toEqual({
        requestId: runningA.requestId,
      });
      yield* answer(cancelFrame.requestId);
      expect(Exit.isSuccess(yield* Fiber.await(cancel))).toBe(true);
      yield* turns();
      expect(yield* Queue.size(outgoing)).toBe(0); // accepted cancel: B still waits for A's answer
      yield* answer(runningA.requestId);
      yield* Fiber.await(a);
      const next = yield* sent;
      expect(next.operationKey).toBe("test.b");
      yield* answer(next.requestId);
      yield* Fiber.await(b);
    }),
);

effectTest(
  "a waiter interrupted at any point of acquisition leaks no place; the line is bounded",
  () =>
    Effect.gen(function* () {
      const { call, sent, answer } = yield* harness;
      const a = yield* call("test.a");
      const runningA = yield* sent;
      // 0 turns: interrupted inside enqueue (before or during the queued receipt); later: waiting.
      for (const at of [0, 1, 2, 3, 5, 8]) {
        const waiter = yield* call(`test.left-${at}`);
        yield* turns(at);
        yield* Fiber.interrupt(waiter);
      }
      yield* answer(runningA.requestId);
      yield* Fiber.await(a);
      // A leaked depth would refuse before the bound; a leaked request would be dispatched.
      const held = yield* call("test.hold");
      const holding = yield* sent;
      expect(holding.operationKey).toBe("test.hold");
      const waiting = [];
      for (let i = 0; i < 7; i++) waiting.push(yield* call(`test.w${i}`));
      yield* turns();
      // The 9th place is a typed refusal, never an unbounded tail.
      const over = yield* Fiber.await(yield* call("test.over"));
      expect(failure(over)).toMatchObject({
        _tag: "BridgeError",
        statusCode: 423,
        outcome: "refused",
        evidence: { notDispatched: true },
      });
      for (const fiber of waiting) expect(fiber.pollUnsafe()).toBeUndefined();
      yield* answer(holding.requestId);
      yield* Fiber.await(held);
      for (let i = 0; i < 7; i++) {
        const next = yield* sent;
        expect(next.operationKey).toBe(`test.w${i}`); // FIFO, and no left waiter in between
        yield* answer(next.requestId);
      }
    }),
);

effectTest(
  "a reconnect of the same process never opens the slot; answers match across sockets",
  () =>
    Effect.gen(function* () {
      const first = yield* harness;
      const a = yield* first.call("test.a");
      const runningA = yield* first.sent;
      const b = yield* first.call("test.b");
      yield* turns();
      const second = yield* first.socket; // same pid + start: same incarnation, new epoch
      expect(second.target.session).toBe(first.target.session);
      yield* turns();
      expect(yield* Queue.size(first.outgoing)).toBe(0);
      expect(yield* Queue.size(second.outgoing)).toBe(0); // B not dispatched on the new socket
      // A late answer on the replaced socket settles A instead of being dropped as unknown.
      yield* first.answer(runningA.requestId);
      expect(Exit.isSuccess(yield* Fiber.await(a))).toBe(true);
      const runningB = yield* second.sent; // B goes out on the current epoch only
      expect(runningB.operationKey).toBe("test.b");
      expect(yield* Queue.size(first.outgoing)).toBe(0);
      yield* first.close; // the old socket closing is harmless
      // Transport lost while B runs natively: B's slot is held through a second reconnect.
      yield* second.close;
      const c = yield* Fiber.await(yield* first.call("test.c"));
      expect(failure(c)).toMatchObject({ _tag: "NoRevitSession" }); // no new work while lost
      const third = yield* first.socket;
      yield* third.answer(runningB.requestId);
      expect(Exit.isSuccess(yield* Fiber.await(b))).toBe(true);
    }),
);

effectTest("transport loss holds the slot until process death, then releases it as unknown", () =>
  Effect.gen(function* () {
    const { life, bridge, call, sent, close, target } = yield* harness;
    const a = yield* call("test.a");
    yield* sent;
    const b = yield* call("test.b");
    yield* turns();
    yield* close; // socket gone; native A may still run
    yield* TestClock.adjust("1 hour");
    yield* turns();
    expect(a.pollUnsafe()).toBeUndefined(); // reconciliation: never released by elapsed time
    expect(b.pollUnsafe()).toBeUndefined();
    expect((yield* bridge.snapshot(target.session)).connected).toBe(false);
    life.alive = false; // process death: a distinct terminal fence
    yield* TestClock.adjust("1 second");
    expect(failure(yield* Fiber.await(a))).toMatchObject({
      _tag: "BridgeError",
      statusCode: 503,
      outcome: "unknown",
    });
    expect(failure(yield* Fiber.await(b))).toMatchObject({
      statusCode: 503,
      outcome: "refused",
      evidence: { notDispatched: true },
    });
    expect(yield* bridge.list).toEqual([]);
  }),
);

effectTest("closing the host fails waiters and cancels the running op out of band", () =>
  Effect.gen(function* () {
    const { bridgeScope, call, sent, answer } = yield* harness;
    const a = yield* call("test.a");
    const runningA = yield* sent;
    const b = yield* call("test.b");
    yield* turns();
    const closing = yield* Effect.forkScoped(Scope.close(bridgeScope, Exit.void));
    const cancelFrame = yield* sent;
    expect(cancelFrame.operationKey).toBe(CANCEL_OPERATION_KEY);
    expect(JSON.parse(cancelFrame.payloadJson ?? "{}")).toEqual({ requestId: runningA.requestId });
    yield* answer(cancelFrame.requestId);
    yield* turns();
    expect(closing.pollUnsafe()).toBeUndefined(); // an accepted cancel is not A's terminal answer
    yield* answer(runningA.requestId);
    yield* Fiber.await(closing);
    const waited = yield* Fiber.await(b);
    expect(failure(waited)).toMatchObject({ statusCode: 503, evidence: { notDispatched: true } });
    expect(failure(yield* Fiber.await(a))).toMatchObject({ statusCode: 503, outcome: "unknown" });
  }),
);

const unsettled = (requestId: string, code = "AbandonedStillRunning") =>
  JSON.stringify({
    kind: "Response",
    response: {
      requestId,
      ok: false,
      statusCode: 423,
      errorMessage: `Revit task ended with '${code}'`,
      issues: [
        {
          instancePath: "$",
          code,
          message: code,
          severity: "error",
          schemaPath: null,
          suggestion: null,
        },
      ],
      metrics: {
        requestBytes: 0,
        responseBytes: 0,
        revitExecutionMs: 0,
        roundTripMs: 0,
        serializationMs: 0,
      },
    },
  });

effectTest(
  "an unsettled answer fails the caller as unknown but holds the slot until terminal evidence",
  () =>
    Effect.gen(function* () {
      const { call, sent, answer, frame, outgoing } = yield* harness;
      const a = yield* call("test.a");
      const runningA = yield* sent;
      const b = yield* call("test.b");
      yield* turns();
      yield* frame(unsettled(runningA.requestId));
      expect(failure(yield* Fiber.await(a))).toMatchObject({
        _tag: "BridgeError",
        outcome: "unknown",
      });
      yield* TestClock.adjust("1 hour");
      yield* turns();
      expect(yield* Queue.size(outgoing)).toBe(0); // B emits no Request frame
      expect(b.pollUnsafe()).toBeUndefined();
      yield* frame(unsettled(runningA.requestId, "TimedOut")); // still not terminal
      yield* turns();
      expect(yield* Queue.size(outgoing)).toBe(0);
      yield* answer(runningA.requestId); // independent terminal evidence for A's id
      const next = yield* sent;
      expect(next.operationKey).toBe("test.b");
      yield* answer(next.requestId);
      expect(Exit.isSuccess(yield* Fiber.await(b))).toBe(true);
    }),
);

effectTest(
  "closing the host while the worker holds a taken, unsent job settles its joiner typed",
  () =>
    Effect.gen(function* () {
      // Hold the "started" receipt: the worker has taken A but has not sent it.
      const held = vi.fn((...args: Parameters<ActionJournal["recordQueue"]>) =>
        args[3] === "started" ? new Promise<never>(() => {}) : Promise.reject(Error("not held")),
      );
      const journal = { recordQueue: held } as unknown as ActionJournal;
      const { bridgeScope, call, outgoing } = yield* harness.pipe(
        Effect.provideService(ActionJournalService, journal),
      );
      const a = yield* call("test.a");
      yield* Effect.promise(() => vi.waitFor(() => expect(held).toHaveBeenCalled()));
      yield* Scope.close(bridgeScope, Exit.void);
      expect(failure(yield* Fiber.await(a))).toMatchObject({
        _tag: "BridgeError",
        statusCode: 503,
        outcome: "refused",
        evidence: { notDispatched: true },
      });
      expect(yield* Queue.size(outgoing)).toBe(0); // no Request frame ever went out
    }),
);

effectTest("retire an empty line, reconnect the same process, and the next op dispatches", () =>
  Effect.gen(function* () {
    const { bridge, socket, close, target } = yield* harness;
    yield* close; // nothing dispatched: the session retires with an empty line
    yield* turns();
    expect(yield* bridge.list).toEqual([]);
    const again = yield* socket; // same pid + start: same broker id, a fresh session
    expect(again.target.session).toBe(target.session);
    const op = yield* Effect.forkScoped(
      again.bridge.invoke("test.a", {}, again.target.session, again.target.openId),
    );
    const frame = yield* again.sent;
    expect(frame.operationKey).toBe("test.a");
    yield* again.answer(frame.requestId);
    expect(Exit.isSuccess(yield* Fiber.await(op))).toBe(true);
  }),
);

effectTest("interrupted waiters take their jobs and payloads out of the physical line", () =>
  Effect.gen(function* () {
    const { call, sent, answer, bridge, target } = yield* harness;
    const lineBytes = Effect.map(bridge.snapshot(target.session), (view) => view.lineBytes!);
    const lineJobs = Effect.map(bridge.snapshot(target.session), (view) => view.lineJobs);
    const a = yield* call("test.a");
    const runningA = yield* sent; // A holds the slot; 7 more fill the line to its 8 places
    const payload = () => ({ bytes: "x".repeat(1024) });
    const waiters = [];
    for (let i = 0; i < 7; i++) waiters.push(yield* call(`test.w${i}`, payload()));
    yield* turns();
    for (const waiter of waiters.slice(0, 6)) yield* Fiber.interrupt(waiter);
    yield* turns();
    expect(yield* lineJobs).toBe(1); // one live waiter: one retained job, one payload
    const retained = yield* lineBytes;
    expect(retained).toBeGreaterThan(1024);
    // Churn behind a running A: every enqueue-then-leave returns its place AND its storage.
    for (let i = 0; i < 50; i++) {
      const churn = yield* call(`test.churn${i}`, payload());
      yield* turns(1);
      yield* Fiber.interrupt(churn);
    }
    expect(yield* lineJobs).toBe(1);
    expect(yield* lineBytes).toBe(retained);
    yield* answer(runningA.requestId);
    yield* Fiber.await(a);
    const next = yield* sent;
    expect(next.operationKey).toBe("test.w6");
    yield* answer(next.requestId);
    yield* Fiber.await(waiters[6]!);
    expect(yield* lineBytes).toBe(0);
  }),
);

// Terminal evidence (ADR 0029 rule 11): the add-in sends a Terminal frame for the exact bridge
// request id once abandoned native work really finishes, and replays undelivered ones on reconnect.
const terminal = (requestId: string, outcome = "Succeeded") => ({
  requestId,
  outcome,
  startedAtUnixMs: 1,
  completedAtUnixMs: 2,
  receiptId: null,
});
const terminalFrame = (requestId: string, outcome?: string) =>
  JSON.stringify({ kind: "Terminal", terminal: terminal(requestId, outcome) });

effectTest("a failed dispatch journal mark stays typed and holds B until A Terminal", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const id = crypto.randomUUID();
    const release = bindActionDispatch(id, {
      refusal: () => null,
      validate: async () => null,
      dispatched: async () => {
        throw Error("journal disk failed");
      },
    });
    yield* Effect.addFinalizer(() => Effect.sync(release));
    const a = yield* h.call("test.a", {}, id);
    const runningA = yield* h.sent;
    const result = yield* Fiber.await(a);
    const b = yield* h.call("test.b");
    yield* turns();
    expect
      .soft(failure(result))
      .toMatchObject({ _tag: "BridgeError", evidence: { dispatched: true } });
    expect(Exit.findErrorOption(result)).toMatchObject({
      _tag: "Some", value: { _tag: "BridgeError", evidence: { dispatched: true } },
    });
    expect(yield* Queue.size(h.outgoing)).toBe(0);
    yield* h.frame(terminalFrame(runningA.requestId));
    const runningB = yield* h.sent;
    expect(runningB.operationKey).toBe("test.b");
    yield* h.answer(runningB.requestId);
    expect(Exit.isSuccess(yield* Fiber.await(b))).toBe(true);
  }),
);
const inFlight = (fields: Record<string, unknown>) => ({
  inFlight: { processId: 42, processStartUtcUnixMs: 1000, ...fields },
});

/** A held, B queued behind it, A answered AbandonedStillRunning: A failed unknown, B waits. */
const abandoned = Effect.gen(function* () {
  const h = yield* harness;
  const a = yield* h.call("test.a");
  const runningA = yield* h.sent;
  const b = yield* h.call("test.b");
  yield* turns();
  yield* h.frame(unsettled(runningA.requestId));
  expect(failure(yield* Fiber.await(a))).toMatchObject({ _tag: "BridgeError", outcome: "unknown" });
  yield* turns();
  expect(yield* Queue.size(h.outgoing)).toBe(0);
  return { ...h, runningA, b };
});

effectTest("a Terminal for an abandoned request releases the slot and B dispatches", () =>
  Effect.gen(function* () {
    const { frame, sent, answer, runningA, b } = yield* abandoned;
    yield* frame(terminalFrame(runningA.requestId, "Succeeded"));
    const next = yield* sent;
    expect(next.operationKey).toBe("test.b");
    yield* answer(next.requestId);
    expect(Exit.isSuccess(yield* Fiber.await(b))).toBe(true);
  }),
);

effectTest(
  "a Terminal right behind its unsettled answer still settles; duplicates are no-ops",
  () =>
    Effect.gen(function* () {
      const { call, sent, frame, batch, answer, outgoing } = yield* harness;
      const a = yield* call("test.a");
      const runningA = yield* sent;
      const b = yield* call("test.b");
      yield* turns();
      // One socket batch: the Terminal lands before A's worker re-arms its reply.
      yield* batch(
        unsettled(runningA.requestId),
        terminalFrame(runningA.requestId, "Failed"),
        terminalFrame(runningA.requestId, "Failed"),
      );
      expect(failure(yield* Fiber.await(a))).toMatchObject({ outcome: "unknown" });
      const runningB = yield* sent;
      expect(runningB.operationKey).toBe("test.b");
      const c = yield* call("test.c");
      yield* frame(terminalFrame(runningA.requestId, "Failed")); // A is released: ignored
      yield* frame(terminalFrame("never-sent")); // unknown id: ignored
      yield* turns();
      expect(yield* Queue.size(outgoing)).toBe(0); // B still holds the slot; C waits
      yield* answer(runningB.requestId);
      expect(Exit.isSuccess(yield* Fiber.await(b))).toBe(true);
      const runningC = yield* sent;
      expect(runningC.operationKey).toBe("test.c");
      yield* answer(runningC.requestId);
      expect(Exit.isSuccess(yield* Fiber.await(c))).toBe(true);
    }),
);

effectTest("a reconnect whose inFlight lists A keeps the slot; a later Terminal releases it", () =>
  Effect.gen(function* () {
    const { close, socketOf, runningA, b, target } = yield* abandoned;
    yield* close;
    const second = yield* socketOf(
      inFlight({
        requests: [
          { requestId: runningA.requestId, state: "AbandonedStillRunning", startedAtUnixMs: 1 },
        ],
      }),
    );
    expect(second.target.session).toBe(target.session);
    yield* TestClock.adjust("1 hour");
    yield* turns();
    expect(yield* Queue.size(second.outgoing)).toBe(0);
    yield* second.frame(terminalFrame(runningA.requestId, "Cancelled"));
    const next = yield* second.sent;
    expect(next.operationKey).toBe("test.b");
    yield* second.answer(next.requestId);
    expect(Exit.isSuccess(yield* Fiber.await(b))).toBe(true);
  }),
);

effectTest("a reconnect replaying A's terminal in inFlight releases the slot on registration", () =>
  Effect.gen(function* () {
    const { close, socketOf, runningA, b } = yield* abandoned;
    yield* close;
    const second = yield* socketOf(inFlight({ terminals: [terminal(runningA.requestId)] }));
    const next = yield* second.sent;
    expect(next.operationKey).toBe("test.b");
    yield* second.answer(next.requestId);
    expect(Exit.isSuccess(yield* Fiber.await(b))).toBe(true);
  }),
);

effectTest(
  "a registration from a new incarnation of the pid fails A unknown and frees the slot",
  () =>
    Effect.gen(function* () {
      const { call, sent, close, socketOf, bridge, outgoing } = yield* harness;
      const a = yield* call("test.a");
      yield* sent; // dispatched, never answered
      const b = yield* call("test.b");
      yield* turns(); // B is queued in the line before the transport goes
      yield* close; // transport lost; the pid probe still says alive (life.alive stays true)
      yield* turns();
      const reborn = yield* socketOf({ processStartUtcUnixMs: 2000 });
      expect(failure(yield* Fiber.await(a))).toMatchObject({
        _tag: "BridgeError",
        statusCode: 503,
        outcome: "unknown",
      });
      expect(failure(yield* Fiber.await(b))).toMatchObject({
        statusCode: 503,
        evidence: { notDispatched: true },
      });
      expect(yield* Queue.size(outgoing)).toBe(0); // B never went out
      expect((yield* bridge.list).map((view) => view.sessionId)).toEqual([reborn.target.session]);
    }),
);

effectTest("duplicate ids and oversized encoded items cannot replace or retain a request", () =>
  Effect.gen(function* () {
    const { call, sent, answer, bridge, target } = yield* harness.pipe(
      Effect.provideService(DispatchLimits, { entries: 2, itemBytes: 512 }),
    );
    const a = yield* call("test.a", {}, "same-id");
    yield* sent;
    const duplicate = yield* call("test.duplicate", {}, "same-id");
    expect(failure(yield* Fiber.await(duplicate))).toMatchObject({ statusCode: 409 });
    const large = yield* call("test.large", { bytes: "x".repeat(512) });
    expect(failure(yield* Fiber.await(large))).toMatchObject({ statusCode: 413 });
    expect((yield* bridge.snapshot(target.session)).lineBytes).toBe(0);
    const b = yield* call("test.b", {}, "queued-id");
    yield* turns();
    const excess = yield* call("test.excess");
    expect(failure(yield* Fiber.await(excess))).toMatchObject({ statusCode: 423 });
    const cancel = yield* Effect.forkScoped(
      bridge.invoke(CANCEL_OPERATION_KEY, { requestId: "queued-id" }),
    );
    yield* Fiber.join(cancel);
    expect(failure(yield* Fiber.await(b))).toMatchObject({ statusCode: 499 });
    expect((yield* bridge.snapshot(target.session)).lineBytes).toBe(0);
    expect((yield* bridge.snapshot(target.session)).lineJobs).toBe(0);
    yield* answer("same-id");
    expect(Exit.isSuccess(yield* Fiber.await(a))).toBe(true);
  }),
);

effectTest("handle terminal survives an unknown answer and reconnect until native terminal", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const handle = yield* h.bridge.invokeHandle(
      "test.handle",
      {},
      h.target.session,
      null,
      "handle-a",
    );
    yield* h.sent;
    yield* h.frame(unsettled("handle-a"));
    expect(failure(yield* Effect.exit(handle.answer))).toMatchObject({ _tag: "BridgeError" });
    const terminalWait = yield* Effect.forkScoped(handle.terminal);
    yield* turns();
    expect(terminalWait.pollUnsafe()).toBeUndefined();
    const second = yield* h.socket;
    yield* turns();
    expect(terminalWait.pollUnsafe()).toBeUndefined();
    yield* second.frame(terminalFrame("handle-a"));
    expect(yield* Fiber.join(terminalWait)).toBe("native-acknowledged");
  }),
);

effectTest("handle terminal reports unknown only when process death fences its dispatch", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const handle = yield* h.bridge.invokeHandle(
      "test.death",
      {},
      h.target.session,
      null,
      "handle-death",
    );
    yield* h.sent;
    yield* h.frame(unsettled("handle-death"));
    yield* Effect.exit(handle.answer);
    const terminalWait = yield* Effect.forkScoped(handle.terminal);
    yield* h.close;
    yield* TestClock.adjust("1 hour");
    yield* turns();
    expect(terminalWait.pollUnsafe()).toBeUndefined();
    h.life.alive = false;
    yield* TestClock.adjust("1 second");
    expect(yield* Fiber.join(terminalWait)).toBe("unknown-until-reconciled");
  }),
);

effectTest("terminal evidence is latched for late waiters and fenced by process incarnation", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const old = yield* h.bridge.invokeHandle("test.old", {}, h.target.session, null, "reused-id");
    yield* h.sent;
    yield* h.frame(terminalFrame("reused-id"));
    yield* Effect.exit(old.answer);
    yield* turns();
    expect(yield* old.terminal).toBe("native-acknowledged");
    expect(yield* old.terminal).toBe("native-acknowledged");
    const next = yield* h.socketOf({ processStartUtcUnixMs: 2000 });
    const current = yield* next.bridge.invokeHandle(
      "test.new",
      {},
      next.target.session,
      null,
      "reused-id",
    );
    yield* next.sent;
    const terminalWait = yield* Effect.forkScoped(current.terminal);
    yield* h.frame(terminalFrame("reused-id"));
    yield* turns();
    expect(terminalWait.pollUnsafe()).toBeUndefined();
    yield* next.answer("reused-id");
    expect(yield* Fiber.join(terminalWait)).toBe("native-acknowledged");
    const answer = yield* current.answer;
    expect(answer.actualTarget.processIncarnation).toEqual({ pid: 42, startedAt: 2000 });
    expect(answer.freshness).toEqual({
      freshnessGeneration: null,
      freshnessEvidence: "unavailable",
    });
  }),
);

effectTest("a cancelled queued handle settles never-dispatched without an answer subscriber", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const a = yield* h.call("test.hold");
    const held = yield* h.sent;
    const b = yield* h.bridge.invokeHandle(
      "test.cancelled",
      {},
      h.target.session,
      null,
      "handle-b",
    );
    yield* h.bridge.invoke(CANCEL_OPERATION_KEY, { requestId: "handle-b" });
    expect(yield* b.terminal).toBe("never-dispatched");
    expect(failure(yield* Effect.exit(b.answer))).toMatchObject({
      _tag: "BridgeError",
      status: 499,
    });
    expect(yield* Queue.size(h.outgoing)).toBe(0);
    expect((yield* h.bridge.snapshot(h.target.session)).lineBytes).toBe(0);
    yield* h.answer(held.requestId);
    yield* Fiber.join(a);
  }),
);
