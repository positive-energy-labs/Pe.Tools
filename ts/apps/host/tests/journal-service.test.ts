import { Context, Effect, Exit, Fiber, Layer, Queue, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionJournal } from "../src/action-journal.ts";
import { RevitBridgeLive, RevitProcessAlive } from "../src/bridge.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import { ReceiptExport } from "../src/receipt-export.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { effectTest } from "./effect-test.ts";

test("a consumer takes a fake journal through a Layer, and no log is required", async () => {
  const recordFact = vi.fn(async () => undefined);
  const fake = { recordFact, close: vi.fn(), subscribe: () => () => {} } as unknown as ActionJournal;
  const scope = await Effect.runPromise(Scope.make());
  const exporter = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* ReceiptExport;
    }).pipe(
      Effect.provide(
        ReceiptExport.layer({ host: null, web: null }).pipe(
          Layer.provide(Layer.succeed(ActionJournalService, fake)),
        ),
      ),
      Scope.provide(scope),
    ),
  );
  expect(exporter.journal).toBe(fake);
  expect(recordFact).toHaveBeenCalledWith({ kind: "diagnostic", code: "identity.unavailable" }, undefined, null, undefined);
  await Effect.runPromise(Scope.close(scope, Exit.void));
  // The exporter is a consumer: releasing it never closes the journal; the journal's Layer does.
  expect(fake.close).not.toHaveBeenCalled();
});

effectTest("the journal Layer closes the journal after the bridge releases, and only then", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "pe-journal-order-")));
    yield* Effect.addFinalizer(() => Effect.promise(() => rm(dir, { recursive: true, force: true })));
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      RevitBridgeLive.pipe(Layer.provideMerge(ActionJournalService.live(null, dir))),
      scope,
    ).pipe(Effect.provideService(RevitProcessAlive, () => true));
    const journal = Context.get(context, ActionJournalService);
    const { bridge, target, outgoing, incoming } = yield* connectTestBridge().pipe(Effect.provide(context));
    const call = yield* Effect.forkScoped(
      bridge.invoke("test.a", {}, target.session, target.openId),
    );
    const running = yield* Queue.take(outgoing); // the call is running: its queue facts are in the journal
    const refused: unknown[] = [];
    const record = journal.recordQueue.bind(journal);
    journal.recordQueue = (...args) => record(...args).catch((error) => (refused.push(error), Promise.reject(error)));
    const close = journal.close.bind(journal);
    let bridgeSettledAtClose: boolean | undefined;
    journal.close = async () => {
      bridgeSettledAtClose = call.pollUnsafe() !== undefined;
      await close();
    };
    const answer = (requestId: string) =>
      Queue.offer(
        incoming,
        JSON.stringify({
          kind: "Response",
          response: {
            requestId, ok: true, statusCode: 200, payloadJson: "{}",
            metrics: { requestBytes: 0, responseBytes: 0, revitExecutionMs: 0, roundTripMs: 0, serializationMs: 0 },
          },
        }),
      );
    const closing = yield* Effect.forkScoped(Scope.close(scope, Exit.void));
    // Closing the bridge cancels the running op out of band and waits for Revit's answers.
    yield* answer((yield* Queue.take(outgoing)).request!.requestId);
    yield* answer(running.request!.requestId);
    yield* Fiber.await(closing);
    expect(bridgeSettledAtClose).toBe(true); // the bridge released first
    expect(Exit.isFailure(yield* Fiber.await(call))).toBe(true);
    expect(refused).toEqual([]); // no queue fact met a closed journal
    expect(((yield* Effect.promise(() => journal.read({ kinds: ["queue"] }))).length)).toBeGreaterThan(0);
    // The journal's Layer finalizer closed it: a later write is refused.
    yield* Effect.promise(() => expect(journal.recordQueue("test.late", "late", "s", "queued", 1)).rejects.toThrow("closed"));
  }),
);
