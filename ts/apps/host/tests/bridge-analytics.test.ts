import { Effect, Fiber, Queue } from "effect";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import { capture } from "@pe/runtime";
import { RevitBridgeLive } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";

vi.mock("@pe/runtime", async (original) => ({
  ...(await original<typeof import("@pe/runtime")>()),
  capture: vi.fn(),
}));

beforeEach(() => vi.mocked(capture).mockClear());

const queueEvents = () =>
  vi
    .mocked(capture)
    .mock.calls.filter(([event]) => event === "bridge_queue")
    .map(([, props]) => props);

const metrics = {
  requestBytes: 0,
  responseBytes: 0,
  revitExecutionMs: 0,
  roundTripMs: 0,
  serializationMs: 0,
};

test("an op behind an unanswered Revit op emits queued with its wire id, without started", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, outgoing, target } = yield* connectTestBridge();
        yield* Effect.forkScoped(bridge.invoke("holding", {}, target.session, null, "holds-gate"));
        yield* Queue.take(outgoing); // The first op is dispatched and never answers.
        yield* Effect.forkScoped(
          bridge.invoke("follower", {}, target.session, null, "waits-behind"),
          { startImmediately: true },
        );
        expect(queueEvents().filter((props) => props.op === "follower")).toEqual([
          {
            op: "follower",
            session_id: target.session,
            request_id: "waits-behind",
            queue_depth: 2,
            phase: "queued",
          },
        ]);
        expect(yield* Queue.size(outgoing)).toBe(0);
      }),
    ).pipe(Effect.provide(RevitBridgeLive)),
  ));

test("an empty queue emits only started; contended phases join when the gate opens", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, incoming, outgoing, target } = yield* connectTestBridge();
        const first = yield* Effect.forkScoped(bridge.invoke("first", {}, target.session, null));
        const sent = yield* Queue.take(outgoing);
        expect(queueEvents()).toEqual([
          {
            op: "first",
            session_id: target.session,
            request_id: sent.request!.requestId,
            queue_depth: 1,
            phase: "started",
            wait_ms: expect.any(Number),
          },
        ]);
        const second = yield* Effect.forkScoped(bridge.invoke("second", {}, target.session, null), {
          startImmediately: true,
        });
        const queued = queueEvents().find((props) => props.phase === "queued")!;
        yield* Queue.offer(
          incoming,
          JSON.stringify({
            kind: "Response",
            response: { requestId: sent.request!.requestId, ok: true, payloadJson: "{}", metrics },
          }),
        );
        yield* Fiber.join(first);
        const next = yield* Queue.take(outgoing);
        expect(queued.request_id).toBe(next.request!.requestId);
        expect(queueEvents().filter((props) => props.request_id === queued.request_id)).toEqual([
          queued,
          { ...queued, phase: "started", wait_ms: expect.any(Number) },
        ]);
        yield* Queue.offer(
          incoming,
          JSON.stringify({
            kind: "Response",
            response: { requestId: next.request!.requestId, ok: true, payloadJson: "{}", metrics },
          }),
        );
        yield* Fiber.join(second);
      }),
    ).pipe(Effect.provide(RevitBridgeLive)),
  ));
