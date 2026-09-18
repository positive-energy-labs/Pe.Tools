import { connectTestBridge } from "./bridge-fixture.ts";
import { partitionFixture } from "./partition-fixture.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Fiber, Layer, Queue } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import { RevitBridge, RevitBridgeLive } from "../src/bridge.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { makeCallRoute } from "../src/call-route.ts";

const metrics = {
  requestBytes: 0,
  responseBytes: 0,
  revitExecutionMs: 0,
  roundTripMs: 0,
  serializationMs: 0,
};

test.each([
  ["AbandonedStillRunning", 423, "unknown"],
  ["RefusedQueueUnresponsive", 423, "failed"],
  ["CancelledBeforeDispatch", 499, "failed"],
  // 499 without notDispatched settles CANCELLED: the op answered, it just answered "stopped".
  ["CancelledCooperatively", 499, "cancelled"],
  ["RefusedQueueDisposed", 503, "failed"],
  ["TimedOut", 504, "unknown"],
  ["FutureNativeOutcome", 400, "unknown"],
  [undefined, 400, "unknown"],
  ["dropped-reply", 503, "unknown"],
] as const)(
  "native frame %s (%s) survives the actual bridge, owner and replay as %s",
  async (code, status, expected) => {
    const dir = await mkdtemp(join(tmpdir(), "pe-executor-"));
    const path = join(dir, "attempts.json");
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { bridge, incoming, outgoing, connection, target } = yield* connectTestBridge();
            const owner = new ActionJournal(path);
            const fixture = yield* Effect.promise(() => partitionFixture(dir, target));
            const serve = (journal: ActionJournal) =>
              HttpRouter.toWebHandler(
                makeCallRoute(journal, fixture.captures, {
                  workspace: fixture.workspace,
                  sdk: sdkSessions,
                }).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
                { disableLogger: true },
              );
            let web = serve(owner);
            const post = (body: unknown) =>
              web.handler(
                new Request("http://host/actions", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(body),
                }),
                Context.empty() as never,
              );
            const original = fixture.intent("original");
            try {
              expect((yield* Effect.promise(() => post(original))).status).toBe(202);
              const preparation = yield* Queue.take(outgoing);
              expect(preparation.request).toMatchObject({
                operationKey: "takeoffs.initialize-carrier",
                openDocumentId: target.openId,
              });
              yield* Queue.offer(
                incoming,
                JSON.stringify({
                  kind: "Response",
                  response: {
                    requestId: preparation.request!.requestId,
                    ok: true,
                    statusCode: 200,
                    payloadJson: JSON.stringify({ remaining: [] }),
                    metrics,
                  },
                }),
              );
              const sent = yield* Queue.take(outgoing);
              expect(sent.request).toMatchObject({
                operationKey: "takeoffs.partition",
                openDocumentId: target.openId,
              });
              if (code === "dropped-reply") yield* Fiber.interrupt(connection);
              else
                yield* Queue.offer(
                  incoming,
                  JSON.stringify({
                    kind: "Response",
                    response: {
                      requestId: sent.request!.requestId,
                      ok: false,
                      statusCode: status,
                      errorMessage: "Identical human message, never parsed",
                      metrics,
                      issues: code
                        ? [{ instancePath: "$", code, message: "opaque", severity: "Error" }]
                        : [],
                    },
                  }),
                );
              const row = yield* Effect.promise(() => owner.wait(original.id));
              // Carrier initialization is a known earlier external effect. A later conclusive refusal is incomplete.
              expect(row.state).toBe(
                expected === "failed"
                  ? "incomplete"
                  : expected === "cancelled"
                    ? "cancelled"
                    : "unknown",
              );
              expect(row.steps.at(-1)).toMatchObject({
                id: sent.request!.requestId,
                state: expected,
                status,
              });
              if (code && code !== "dropped-reply" && expected !== "cancelled")
                expect(row.steps.at(-1)).toMatchObject({
                  nativeOutcome: code,
                  issues: [{ code, instancePath: "$" }],
                });
              expect(row.destination).toEqual(original.destination);
              yield* Effect.promise(() => web.dispose());
              const reconstructed = new ActionJournal(path);
              web = serve(reconstructed);
              expect((yield* Effect.promise(() => post(original))).status).toBe(200);
              const replay = yield* Effect.promise(() => reconstructed.wait(original.id));
              expect(replay).toEqual(row);
              expect(
                (yield* Effect.promise(() =>
                  post({ ...original, input: { ...original.input, zoneRegion: 999 } }),
                )).status,
              ).toBe(409);
              if (expected === "unknown")
                expect((yield* Effect.promise(() => post(fixture.intent("new-id")))).status).toBe(
                  409,
                );
              expect(yield* Queue.size(outgoing)).toBe(0);
            } finally {
              yield* Effect.promise(() => web.dispose());
            }
          }),
        ).pipe(Effect.provide(RevitBridgeLive)),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  10_000,
);

test("current journal ignores unknown envelope fields without a compatibility branch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-executor-current-envelope-"));
  try {
    const path = join(dir, "attempts.json");
    await writeFile(path, JSON.stringify({ version: 3, actions: [], legacy: { retained: true } }));
    expect(await new ActionJournal(path).list()).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
