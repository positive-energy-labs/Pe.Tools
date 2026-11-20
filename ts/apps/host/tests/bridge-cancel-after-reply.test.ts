import { Cause, Effect, Exit, Fiber, Layer, Queue, Scope } from "effect";
import { expect } from "vite-plus/test";
import type { BridgeFrame } from "@pe/host-contracts/contracts";
import { CANCEL_OPERATION_KEY, RevitBridgeLive, RevitProcessAlive } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { effectTest } from "./effect-test.ts";

// Drive round 4, defect 3: the registry's cancel names only the request id, never a session
// (command-registry.ts). Once the host has read that request's reply, no session holds it.
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

const connected = Effect.gen(function* () {
  const scope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  const context = yield* Layer.buildWithScope(RevitBridgeLive, scope).pipe(
    Effect.provideService(RevitProcessAlive, () => true),
  );
  const { bridge, incoming, outgoing, connection, target } = yield* connectTestBridge(42, {}).pipe(
    Effect.provide(context),
  );
  // One request, sent and answered: the host has read its reply and released it.
  const running = yield* Effect.forkScoped(
    bridge.invoke("test.write", {}, target.session, target.openId, "write-1"),
  );
  const sent: BridgeFrame = yield* Queue.take(outgoing);
  yield* Queue.offer(incoming, response(sent.request!.requestId));
  yield* Fiber.join(running);
  return { bridge, outgoing, close: Fiber.interrupt(connection) };
});

effectTest(
  "a Stop for a request whose reply was read, bridge connected, is 'not in flight', never 'no session'",
  () =>
    Effect.gen(function* () {
      const { bridge, outgoing } = yield* connected;
      const exit = yield* Effect.exit(
        bridge.invoke(CANCEL_OPERATION_KEY, { requestId: "write-1" }),
      );
      expect(Exit.isSuccess(exit) ? undefined : String(Cause.squash(exit.cause))).toBeUndefined();
      expect(Exit.isSuccess(exit) && exit.value.value).toMatchObject({
        cancelled: false,
        requestId: "write-1",
      });
      // The answer is the host's own: nothing is sent to Revit for an id no session holds.
      expect(yield* Queue.size(outgoing)).toBe(0);
    }),
);

effectTest("the same Stop with the bridge gone still says no Revit session is connected", () =>
  Effect.gen(function* () {
    const { bridge, close } = yield* connected;
    yield* close;
    const exit = yield* Effect.exit(bridge.invoke(CANCEL_OPERATION_KEY, { requestId: "write-1" }));
    expect(Exit.isFailure(exit) && String(Cause.squash(exit.cause))).toMatch(
      /No Revit session is connected to the bridge/,
    );
  }),
);
