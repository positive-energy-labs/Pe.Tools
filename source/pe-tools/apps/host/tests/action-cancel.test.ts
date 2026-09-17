/**
 * A cancel reaches the op while it runs. The socket here is a fake, everything above it — the
 * request table, the per-session FIFO gate, the journal, `/actions` and `/actions/cancel` — is
 * production code. The op never answers until the test decides to answer it, so "the cancel
 * arrived while the op was still running" is the assertion, not an inference from timing.
 */
import { connectTestBridge } from "./bridge-fixture.ts";
import { partitionFixture } from "./partition-fixture.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { mkdtemp, rm } from "node:fs/promises";
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

const lane = <A, E, R>(body: (harness: Harness) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "pe-cancel-")));
    const { bridge, incoming, outgoing, target } = yield* connectTestBridge();
    const owner = new ActionJournal(join(dir, "attempts.json"));
    const fixture = yield* Effect.promise(() => partitionFixture(dir, target));
    const web = HttpRouter.toWebHandler(
      makeCallRoute(owner, fixture.captures, {
        workspace: fixture.workspace,
        sdk: sdkSessions,
      }).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
      { disableLogger: true },
    );
    const post = (path: string, body: unknown) =>
      Effect.promise(() =>
        web.handler(
          new Request(`http://host${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          Context.empty() as never,
        ),
      );
    const answer = (requestId: string, response: Record<string, unknown>) =>
      Queue.offer(
        incoming,
        JSON.stringify({ kind: "Response", response: { requestId, metrics, ...response } }),
      );
    try {
      return yield* body({ owner, outgoing, post, answer, fixture });
    } finally {
      yield* Effect.promise(() => web.dispose());
      yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
    }
  }).pipe(
    Effect.scoped,
    Effect.provide(RevitBridgeLive),
    // The lane's own effects carry RevitBridge and Scope; both are supplied above.
    (effect) => Effect.runPromise(effect as Effect.Effect<A>),
  );

type Harness = {
  owner: ActionJournal;
  outgoing: Queue.Queue<import("@pe/host-contracts/contracts").BridgeFrame>;
  post: (path: string, body: unknown) => Effect.Effect<Response>;
  answer: (requestId: string, response: Record<string, unknown>) => Effect.Effect<boolean>;
  fixture: Awaited<ReturnType<typeof partitionFixture>>;
};

test("admission answers before the bridge answers anything", () =>
  lane(({ outgoing, post, fixture, owner, answer }) =>
    Effect.gen(function* () {
      const intent = fixture.intent("admitted-first");
      // Nothing has been offered on `incoming`, so every bridge call this admission makes is
      // unanswerable for the whole of this assertion.
      const accepted = yield* post("/actions", intent);
      expect(accepted.status).toBe(202);
      expect(((yield* Effect.promise(() => accepted.json())) as { state: string }).state).toBe(
        "running",
      );
      // Only now does the first bridge frame exist — the 202 did not wait for it.
      const preparation = yield* Queue.take(outgoing);
      expect(preparation.request?.operationKey).toBe("takeoffs.initialize-carrier");
      yield* answer(preparation.request!.requestId, {
        ok: false,
        statusCode: 499,
        errorMessage: "stop",
        issues: [{ instancePath: "$", code: "Cancelled", message: "stop", severity: "Error" }],
      });
      yield* Effect.promise(() => owner.wait(intent.id));
    }),
  ));

test("a cancel reaches the op while it blocks, and the action settles cancelled", () =>
  lane(({ owner, outgoing, post, answer, fixture }) =>
    Effect.gen(function* () {
      const intent = fixture.intent("cancel-me");
      expect((yield* post("/actions", intent)).status).toBe(202);
      const preparation = yield* Queue.take(outgoing);
      yield* answer(preparation.request!.requestId, {
        ok: true,
        statusCode: 200,
        payloadJson: JSON.stringify({ remaining: [] }),
      });
      // The native step is dispatched and BLOCKS: nothing is ever offered for its requestId until
      // the cancel has been observed on the wire.
      const running = yield* Queue.take(outgoing);
      expect(running.request?.operationKey).toBe("takeoffs.partition");
      const blocked = running.request!.requestId;

      // Forked because the control waits for Revit's acknowledgement, and in this lane the test
      // IS Revit. In a session the pump answers `op.cancel` without queueing it.
      const stopping = yield* Effect.forkScoped(post("/actions/cancel", { id: intent.id }));

      // THE CLAIM: `op.cancel` is on the wire while `takeoffs.partition` is still unanswered.
      const cancel = yield* Queue.take(outgoing);
      expect(cancel.request?.operationKey).toBe("op.cancel");
      expect(JSON.parse(cancel.request!.payloadJson)).toEqual({ requestId: blocked });

      yield* answer(cancel.request!.requestId, {
        ok: true,
        statusCode: 200,
        payloadJson: JSON.stringify({ cancelled: true, requestId: blocked }),
      });
      expect((yield* Fiber.join(stopping)).status).toBe(202);

      // Revit stops at its checkpoint and answers 499, exactly as BridgeRequestPump does.
      yield* answer(blocked, {
        ok: false,
        statusCode: 499,
        errorMessage: "Operation 'takeoffs.partition' was cancelled.",
        issues: [
          {
            instancePath: "$",
            code: "Cancelled",
            message: "Operation 'takeoffs.partition' was cancelled.",
            severity: "Error",
          },
        ],
      });

      const row = yield* Effect.promise(() => owner.wait(intent.id));
      expect(row.state).toBe("cancelled");
      expect(row).toMatchObject({ status: 499 });
      expect(row.steps.at(-1)).toMatchObject({ id: blocked, state: "cancelled", status: 499 });
    }),
  ));

test("a cancel for a request still behind the host gate never reaches Revit", () =>
  lane(({ outgoing, answer }) =>
    Effect.gen(function* () {
      const bridge = yield* RevitBridge;
      // A long read holds the gate — the `/families` matrix read is the real one (w4-revit
      // defect 8); everything a route dispatches after it waits behind it.
      const holding = yield* Effect.forkScoped(
        bridge.invoke("revit.catalog.loaded-families", {}, undefined, null, "holds-the-gate"),
      );
      const held = yield* Queue.take(outgoing);
      expect(held.request?.requestId).toBe("holds-the-gate");

      const queued = yield* Effect.forkScoped(
        bridge.invoke("takeoffs.partition", {}, undefined, null, "waits-behind"),
      );
      yield* Effect.sleep("50 millis"); // let the fork reach the gate; queueing is all in-memory
      const stopped = yield* bridge.invoke("op.cancel", { requestId: "waits-behind" });
      expect(stopped.value).toMatchObject({ cancelled: true, requestId: "waits-behind" });
      // No frame for it: the cancel was answered by the host, not by Revit.
      expect(yield* Queue.size(outgoing)).toBe(0);

      yield* answer("holds-the-gate", { ok: true, statusCode: 200, payloadJson: "{}" });
      yield* Fiber.join(holding);
      const refusal = yield* Effect.flip(Fiber.join(queued));
      expect(refusal).toMatchObject({
        statusCode: 499,
        evidence: { notDispatched: true, nativeOutcome: "CancelledBeforeDispatch" },
      });
      expect(yield* Queue.size(outgoing)).toBe(0);
    }),
  ));
