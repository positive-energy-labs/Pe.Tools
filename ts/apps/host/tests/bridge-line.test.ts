import { Cause, Effect, Exit, Fiber, Layer, Queue, Scope } from "effect";
import { expect } from "vite-plus/test";
import type { BridgeFrame } from "@pe/host-contracts/contracts";
import { CANCEL_OPERATION_KEY, RevitBridgeLive } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { effectTest } from "./effect-test.ts";

// The session line's law (ADR 0029 phase 3b; a PROVEN 7.6 GB regression class lives behind it):
// interrupting a waiter removes it and nothing else, op.cancel never takes a place in the line,
// and the place is released only when Revit answers. Only the socket is fake.

/** Event-loop turns, not time: lets queued fibers and journal promises run before a negative check. */
const turns = (n = 5) =>
  Effect.promise(async () => {
    for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
  });

const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

const harness = Effect.gen(function* () {
  const bridgeScope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(RevitBridgeLive, bridgeScope);
  const { bridge, incoming, outgoing, target } = yield* connectTestBridge().pipe(
    Effect.provide(context),
  );
  const call = (key: string, payload: unknown = {}, requestId?: string) =>
    Effect.forkScoped(bridge.invoke(key, payload, target.session, target.openId, requestId));
  /** The next Request frame Revit receives. */
  const sent = Queue.take(outgoing).pipe(
    Effect.map((frame: BridgeFrame) => frame.request!),
  );
  const answer = (requestId: string) =>
    Queue.offer(
      incoming,
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
      }),
    );
  return { bridge, bridgeScope, outgoing, call, sent, answer };
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

effectTest("op.cancel for the running op reaches Revit before that op releases", () =>
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
    expect(yield* Queue.size(outgoing)).toBe(0); // B still waits behind A
    yield* answer(cancelFrame.requestId);
    expect(Exit.isSuccess(yield* Fiber.await(cancel))).toBe(true);
    yield* answer(runningA.requestId);
    yield* Fiber.await(a);
    const next = yield* sent;
    expect(next.operationKey).toBe("test.b");
    yield* answer(next.requestId);
    yield* Fiber.await(b);
  }),
);

effectTest("a waiter interrupted at any point of acquisition leaks no place in the line", () =>
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
    const over = yield* Fiber.await(yield* call("test.over"));
    expect(failure(over)).toMatchObject({ statusCode: 423, evidence: { notDispatched: true } });
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
    expect(closing.pollUnsafe()).toBeUndefined(); // the slot is held until Revit acknowledges
    yield* answer(cancelFrame.requestId);
    yield* Fiber.await(closing);
    const waited = yield* Fiber.await(b);
    expect(failure(waited)).toMatchObject({ statusCode: 503, evidence: { notDispatched: true } });
    expect(failure(yield* Fiber.await(a))).toMatchObject({ statusCode: 503 });
  }),
);
