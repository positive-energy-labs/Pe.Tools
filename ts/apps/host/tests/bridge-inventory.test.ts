import { Effect, Fiber, Queue } from "effect";
import { expect, test } from "vite-plus/test";
import { RevitBridgeLive } from "../src/bridge.ts";
import { listBridgeSessions } from "../src/local-ops.ts";
import { connectTestBridge } from "./bridge-fixture.ts";

// D28: the native LoadFamily trace ended with a snapshot containing its temporary family.
// The native producer must supply a final census after the API call, including in headless Revit.
test("the final family-load census removes the family from every inventory reader", () =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { bridge, incoming, outgoing, target } = yield* connectTestBridge();
    const initial = (yield* bridge.snapshot(target.session)).state!;
    const run = yield* Effect.forkScoped(bridge.invoke("test.family-load", {}, target.session, target.openId));
    const request = (yield* Queue.take(outgoing)).request!;
    const family = { openId: "temporary-family", title: "Round Takeoff - Tight 1in",
      address: "C:/families/tight.rfa", isFamilyDocument: true, isActive: false, projectHome: null };
    const duringLoad = { ...initial, openDocuments: [...initial.openDocuments, family] };
    const event = { kind: "Event", event: { eventName: "document-changed", payloadJson: JSON.stringify({
      reason: "Opened", openDocumentCount: duringLoad.openDocuments.length,
    }) } };
    const drained = Promise.withResolvers<void>();
    const stop = bridge.subscribe(e => { if (e.eventName === "test.drained") drained.resolve(); });
    try {
      yield* Queue.offer(incoming, [
        JSON.stringify({ kind: "StateSync", stateSync: { state: duringLoad } }),
        JSON.stringify(event),
        // The corrected native trace: the queued post-open callback reads the final document set.
        JSON.stringify({ kind: "StateSync", stateSync: { state: initial } }),
        JSON.stringify({ kind: "Response", response: { requestId: request.requestId, ok: true, statusCode: 200, payloadJson: "{}",
          metrics: { requestBytes: 0, responseBytes: 0, revitExecutionMs: 0, roundTripMs: 0, serializationMs: 0 } } }),
        // An older invalidation can arrive after the census; it must never author membership.
        JSON.stringify(event),
        JSON.stringify({ kind: "Event", event: { eventName: "test.drained", payloadJson: "{}" } }),
      ]);
      yield* Effect.promise(() => drained.promise);
      yield* Fiber.join(run);
      const expected = initial.openDocuments.map(d => d.openId);
      expect((yield* bridge.snapshot(target.session)).state!.openDocuments.map(d => d.openId)).toEqual(expected);
      expect((yield* bridge.list)[0]!.state!.openDocuments.map(d => d.openId)).toEqual(expected);
      const picker = yield* listBridgeSessions(bridge.list);
      expect(picker.sessions[0]!.openDocuments!.map(d => d.openId)).toEqual(expected);
    } finally { stop(); }
  })).pipe(Effect.provide(RevitBridgeLive))));
