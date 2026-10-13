import { receiptGoldenEnvelope } from "../../../packages/agent-contracts/tests/receipt-fixture.ts";
import { Effect, Fiber, Queue } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { type Receipt } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { recordBridgeQueue } from "../src/gateway-owner.ts";
import { RevitBridgeLive, subscribeReceiptProducers } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";

vi.mock("../src/gateway-owner.ts", () => ({ recordBridgeQueue: vi.fn() }));
let owner: ActionJournal;
let dir: string;
let seen: Receipt[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pe-queue-spine-"));
  owner = new ActionJournal(join(dir, "actions.json"), () => ({
    ...receiptGoldenEnvelope.stamp!,
    component: "host",
  }));
  seen = [];
  owner.subscribe({ kinds: ["queue"] }, (r) => {
    seen.push(r);
  });
  vi.mocked(recordBridgeQueue).mockImplementation((...args) => owner.recordQueue(...args));
});
afterEach(async () => {
  await owner.read({});
  await rm(dir, { recursive: true, force: true });
});
const queued = () =>
  Effect.promise(async () => {
    const existing = seen.find((r) => r.body.kind === "queue" && r.body.phase === "queued");
    if (existing) return existing;
    return new Promise<Receipt>((resolve) => {
      const stop = owner.subscribe({ kinds: ["queue"] }, (r) => {
        if (r.body.kind === "queue" && r.body.phase === "queued") {
          stop();
          resolve(r);
        }
      });
    });
  });
const metrics = {
  requestBytes: 0,
  responseBytes: 0,
  revitExecutionMs: 0,
  roundTripMs: 0,
  serializationMs: 0,
};

test("receipt.producer is admitted to the host-only tap and never the generic UI stream", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, incoming, target } = yield* connectTestBridge();
        const generic: unknown[] = [];
        const stopEvents = bridge.subscribe((event) => {
          generic.push(event);
        });
        const delivered = Promise.withResolvers<import("../src/bridge.ts").NativeReceiptProducer>();
        const stopProducer = subscribeReceiptProducers(delivered.resolve);
        try {
          const r = receiptGoldenEnvelope;
          const payload = {
            schema: 1,
            id: r.id,
            at: r.at,
            join: r.join,
            body: {
              kind: "diagnostic",
              code: "native.failed",
              localRef: { path: "C:/private/model.log" },
            },
            emitter: { version: r.stamp!.version, build: r.stamp!.build, commit: r.stamp!.commit },
          };
          yield* Queue.offer(
            incoming,
            JSON.stringify({
              kind: "Event",
              event: { eventName: "receipt.producer", payloadJson: JSON.stringify(payload) },
            }),
          );
          const admitted = yield* Effect.promise(() => delivered.promise);
          expect(admitted.fact).toEqual(payload);
          expect(admitted.connection).toEqual({
            sessionId: target.session,
            processId: 42,
            processStartUtcUnixMs: 1000,
            lane: "dev",
            buildStamp: null,
          });
          expect(generic).toEqual([]);
          const ordinary = Promise.withResolvers<void>();
          const stop = bridge.subscribe((event) => {
            if (event.eventName === "ordinary") ordinary.resolve();
          });
          yield* Queue.offer(
            incoming,
            JSON.stringify({
              kind: "Event",
              event: {
                eventName: "receipt.producer",
                payloadJson: JSON.stringify({ ...payload, installId: r.stamp!.installId }),
              },
            }),
          );
          yield* Queue.offer(
            incoming,
            JSON.stringify({ kind: "Event", event: { eventName: "ordinary", payloadJson: "{}" } }),
          );
          yield* Effect.promise(() => ordinary.promise);
          expect(generic).toHaveLength(1);
          expect(JSON.stringify(generic)).not.toContain("private");
          stop();
        } finally {
          stopEvents();
          stopProducer();
        }
      }),
    ).pipe(Effect.provide(RevitBridgeLive)),
  ));

test("a never-opening gate durably publishes only queued for its follower", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, outgoing, target } = yield* connectTestBridge();
        yield* Effect.forkScoped(bridge.invoke("holding", {}, target.session, null));
        yield* Queue.take(outgoing);
        yield* Effect.forkScoped(bridge.invoke("follower", {}, target.session, null), {
          startImmediately: true,
        });
        const receipt = yield* queued();
        expect(receipt.body).toEqual({
          kind: "queue",
          op: "follower",
          depth: 2,
          phase: "queued",
          processSessionId: expect.any(String),
        });
        expect(JSON.stringify(receipt)).not.toContain(target.session);
        expect(
          yield* Effect.promise(() => owner.read({ requestId: receipt.join.requestId })),
        ).toEqual([receipt]);
        expect(yield* Queue.size(outgoing)).toBe(0);
      }),
    ).pipe(Effect.provide(RevitBridgeLive)),
  ));

test("empty gate publishes started; contended gate joins queued and started on the native wire UUID", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, incoming, outgoing, target } = yield* connectTestBridge();
        const first = yield* Effect.forkScoped(bridge.invoke("first", {}, target.session, null));
        const sent = yield* Queue.take(outgoing);
        expect(seen.map((r) => r.body)).toEqual([
          {
            kind: "queue",
            op: "first",
            depth: 1,
            phase: "started",
            waitMs: expect.any(Number),
            processSessionId: expect.any(String),
          },
        ]);
        const second = yield* Effect.forkScoped(bridge.invoke("second", {}, target.session, null), {
          startImmediately: true,
        });
        const waiting = yield* queued();
        yield* Queue.offer(
          incoming,
          JSON.stringify({
            kind: "Response",
            response: { requestId: sent.request!.requestId, ok: true, payloadJson: "{}", metrics },
          }),
        );
        yield* Fiber.join(first);
        const next = yield* Queue.take(outgoing);
        expect(waiting.join.requestId).toBe(next.request!.requestId);
        const facts = yield* Effect.promise(() =>
          owner.read({ requestId: waiting.join.requestId }),
        );
        expect(facts.map((r) => r.body)).toEqual([
          waiting.body,
          { ...waiting.body, phase: "started", waitMs: expect.any(Number) },
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
