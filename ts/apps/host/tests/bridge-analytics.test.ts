import { receiptGoldenEnvelope } from "../../../packages/agent-contracts/tests/receipt-fixture.ts";
import { Effect, Queue } from "effect";
import { expect, test } from "vite-plus/test";
import { RevitBridgeLive, subscribeReceiptProducers } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";

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
