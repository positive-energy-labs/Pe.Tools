import { Cause, Effect, Exit, Fiber, Layer, Queue, Scope } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vite-plus/test";
import type { BridgeFrame } from "@pe/host-contracts/contracts";
import { CANCEL_OPERATION_KEY, RevitBridgeLive, RevitProcessAlive } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
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
  /** One fake socket of Revit process 42 (the same incarnation every time). */
  const socket = Effect.gen(function* () {
    const { bridge, incoming, outgoing, connection, target } = yield* connectTestBridge().pipe(
      Effect.provide(context),
    );
    return {
      bridge,
      target,
      outgoing,
      /** The next Request frame this socket carries. */
      sent: Queue.take(outgoing).pipe(Effect.map((frame: BridgeFrame) => frame.request!)),
      answer: (requestId: string) => Queue.offer(incoming, response(requestId)),
      close: Fiber.interrupt(connection),
    };
  });
  const first = yield* socket;
  const call = (key: string, payload: unknown = {}, requestId?: string) =>
    Effect.forkScoped(
      first.bridge.invoke(key, payload, first.target.session, first.target.openId, requestId),
    );
  return { life, bridgeScope, socket, call, ...first };
});

effectTest("interrupting a waiter never lets the one behind it overtake the running op", () =>
  Effect.gen(function* () {
    const { call, sent, answer, outgoing } = yield* harness;
    const a = yield* call("test.a");
    const runningA = yield* sent;
    expect(runningA.operationKey).toBe("test.a");
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

effectTest("op.cancel reaches Revit while A runs, and its acceptance does not release A's slot", () =>
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
    expect(JSON.parse(cancelFrame.payloadJson ?? "{}")).toEqual({ requestId: runningA.requestId });
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

effectTest("a waiter interrupted at any point of acquisition leaks no place; the line is bounded", () =>
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

effectTest("a reconnect of the same process never opens the slot; answers match across sockets", () =>
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
