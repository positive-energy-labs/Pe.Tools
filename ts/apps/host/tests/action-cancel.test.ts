/**
 * A cancel reaches the op while it runs. The socket here is a fake, everything above it — the
 * request table, the per-session FIFO gate, the journal, `/actions` and `/actions/cancel` — is
 * production code. The op never answers until the test decides to answer it, so "the cancel
 * arrived while the op was still running" is the assertion, not an inference from timing.
 * The same lane pins what a refusal and a lost reply leave behind on the document.
 */
import { connectTestBridge } from "./bridge-fixture.ts";
import { partitionFixture } from "./partition-fixture.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Fiber, Layer, Queue } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import { RevitBridge, RevitBridgeLive } from "../src/bridge.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { readNativeReceipt } from "../src/native-receipts.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";

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
    const { bridge, incoming, outgoing, connection, target } = yield* connectTestBridge();
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
    const get = (path: string) =>
      Effect.promise(async () =>
        (await web.handler(new Request(`http://host${path}`), Context.empty() as never)).json(),
      );
    const answer = (requestId: string, response: Record<string, unknown>) =>
      Queue.offer(
        incoming,
        JSON.stringify({ kind: "Response", response: { requestId, metrics, ...response } }),
      );
    try {
      const disconnect = Fiber.interrupt(connection);
      return yield* body({ owner, outgoing, post, get, answer, disconnect, fixture });
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
  get: (path: string) => Effect.Effect<unknown>;
  answer: (requestId: string, response: Record<string, unknown>) => Effect.Effect<boolean>;
  /** The socket closes: every request Revit has not answered loses its reply. */
  disconnect: Effect.Effect<unknown>;
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
  lane(({ owner, outgoing, post, get, answer, fixture }) =>
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
      // The step's input was on disk before its frame reached the wire.
      const { home } = yield* Effect.promise(() => owner.outputs(intent.id));
      const exported = JSON.parse(
        yield* Effect.promise(() => readFile(join(home, "steps", `${blocked}.json`), "utf8")),
      );
      expect(exported).toMatchObject({ id: blocked, kind: "native", key: "takeoffs.partition" });
      expect(JSON.parse(running.request!.payloadJson)).toMatchObject(exported.input);

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
      // Cancelled partial work stays discoverable by the original ID; the export claims no outcome.
      const output = (yield* get(`/actions?output=${intent.id}`)) as {
        id: string;
        files: Record<string, unknown>;
      };
      expect(output.id).toBe(intent.id);
      expect(Object.keys(output.files).sort()).toEqual(
        [
          "admission.json",
          "preparation.json",
          ...row.steps.map((step) => `steps/${step.id}.json`),
        ].sort(),
      );
      expect(output.files["admission.json"]).toEqual(intent);
      expect(JSON.stringify(output.files)).not.toContain("cancelled");
    }),
  ));

test("an exact cancelled SDK receipt settles a lost reply once without replaying prior work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-cancel-recovery-"));
  const path = join(dir, "attempts.json");
  const fixture = await partitionFixture(dir, {
    session: "cancel-recovery",
    openId: "cancel-recovery",
  });
  const intent = fixture.intent("lost-cancel-reply");
  let effects = 0;
  try {
    const interrupted = new ActionJournal(path);
    await interrupted.admit(
      intent,
      async () => ({ kind: "native-leaf", originalProcess }),
      async (execution) => {
        await execution.step("file", "prior", {}, async () => ++effects);
        return execution.step("native", "takeoffs.partition", {}, async () => {
          ++effects;
          return new Promise(() => undefined);
        });
      },
    );
    while (JSON.parse(await readFile(path, "utf8")).actions[0].steps.length !== 2)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const envelope = JSON.parse(await readFile(path, "utf8"));
    const nativeId = envelope.actions[0].steps[1].id;
    envelope.actions[0].steps.push({
      id: "22222222-2222-4222-8222-222222222222",
      key: "native.followup",
      kind: "native",
      input: {},
      state: "running",
    });
    await writeFile(path, JSON.stringify(envelope));

    const recovered = new ActionJournal(path);
    const read = (_args: readonly string[]) => {
      return Promise.resolve(
        sdkEnvelope({
          state: "cancelled",
          requestId: nativeId,
          receipt: {
            requestId: nativeId,
            key: "takeoffs.partition",
            pid: originalProcess.pid,
            processStartUtc: originalProcess.processStartUtc,
            verdict: "cancelled",
          },
          response: { error: "stopped at checkpoint", statusCode: 499 },
        }),
      );
    };
    let resolveFollowup = false;
    const recover = (step: Parameters<typeof readNativeReceipt>[0]) =>
      step.id === nativeId
        ? readNativeReceipt(step, originalProcess, read)
        : Promise.resolve({
            step: resolveFollowup
              ? {
                  id: step.id,
                  key: step.key,
                  kind: step.kind,
                  input: step.input,
                  state: "succeeded" as const,
                  result: { preserved: true },
                }
              : step,
            evidence: { diagnostics: resolveFollowup ? [] : ["still ambiguous"] },
          });
    const unresolved = await recovered.recover(intent.id, recover);
    resolveFollowup = true;
    const first = await recovered.recover(intent.id, recover);
    const second = await recovered.recover(intent.id, recover);

    expect(unresolved.state).toBe("unknown");
    expect(first).toMatchObject({ state: "cancelled", status: 499 });
    expect(first.steps).toMatchObject([
      { key: "prior", state: "succeeded", result: 1 },
      { key: "takeoffs.partition", state: "cancelled", status: 499 },
      { key: "native.followup", state: "succeeded", result: { preserved: true } },
    ]);
    expect(second).toEqual(first);
    expect(effects).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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

test("Revit answering 'not in flight' is a refusal the stop control can print, not a stop", () =>
  lane(({ owner, outgoing, post, answer, fixture }) =>
    Effect.gen(function* () {
      const intent = fixture.intent("already-gone");
      expect((yield* post("/actions", intent)).status).toBe(202);
      const preparation = yield* Queue.take(outgoing);
      yield* answer(preparation.request!.requestId, {
        ok: true,
        statusCode: 200,
        payloadJson: JSON.stringify({ remaining: [] }),
      });
      const running = yield* Queue.take(outgoing);
      const blocked = running.request!.requestId;

      const stopping = yield* Effect.forkScoped(post("/actions/cancel", { id: intent.id }));
      const cancel = yield* Queue.take(outgoing);
      const message = `Request '${blocked}' is not in flight; nothing to cancel.`;
      yield* answer(cancel.request!.requestId, {
        ok: true,
        statusCode: 200,
        payloadJson: JSON.stringify({ cancelled: false, requestId: blocked, message }),
      });
      const response = yield* Fiber.join(stopping);
      expect(response.status).toBe(409);
      expect(yield* Effect.promise(() => response.json())).toEqual({ error: message });

      yield* answer(blocked, { ok: true, statusCode: 200, payloadJson: "{}" });
      yield* Effect.promise(() => owner.wait(intent.id));
    }),
  ));

/** Revit's own answer to a request it refused, as BridgeAgent writes a BridgeOperationException. */
const headlessRefusal = {
  ok: false,
  statusCode: 409,
  errorMessage: "'Model' is headless (open with no window), so it has no active view.",
  issues: [
    {
      instancePath: "$",
      code: "DocumentHeadless",
      message: "This request needs the active view.",
      severity: "error",
    },
  ],
};

test("a refusal Revit answers settles failed, and the next mutation on the document is admitted", () =>
  lane(({ owner, outgoing, post, answer, fixture }) =>
    Effect.gen(function* () {
      const refused = fixture.intent("refused-by-revit");
      expect((yield* post("/actions", refused)).status).toBe(202);
      const first = yield* Queue.take(outgoing);
      yield* answer(first.request!.requestId, headlessRefusal);
      const row = yield* Effect.promise(() => owner.wait(refused.id));
      expect(row).toMatchObject({
        state: "failed",
        status: 409,
        nativeOutcome: "DocumentHeadless",
      });
      expect(row.steps).toMatchObject([{ id: first.request!.requestId, state: "failed" }]);
      // Revit received it, so the receipt never claims it was not dispatched.
      expect("notDispatched" in row && row.notDispatched).toBeFalsy();

      const next = fixture.intent("after-the-refusal");
      expect((yield* post("/actions", next)).status).toBe(202);
      const second = yield* Queue.take(outgoing);
      yield* answer(second.request!.requestId, { ok: true, payloadJson: '{"remaining":[]}' });
      const partition = yield* Queue.take(outgoing);
      expect(partition.request?.operationKey).toBe("takeoffs.partition");
      yield* answer(partition.request!.requestId, { ok: true, payloadJson: "{}" });
      expect((yield* Effect.promise(() => owner.wait(next.id))).state).toBe("succeeded");
    }),
  ));

test("a reply lost mid-write settles unknown and blocks the next mutation on the document", () =>
  lane(({ owner, outgoing, post, disconnect, fixture }) =>
    Effect.gen(function* () {
      const lost = fixture.intent("lost-mid-write");
      expect((yield* post("/actions", lost)).status).toBe(202);
      yield* Queue.take(outgoing);
      yield* disconnect;
      const row = yield* Effect.promise(() => owner.wait(lost.id));
      expect(row).toMatchObject({ state: "unknown", status: 503 });

      const blocked = yield* post("/actions", fixture.intent("behind-the-unknown"));
      expect(blocked.status).toBe(409);
      expect(((yield* Effect.promise(() => blocked.json())) as { message: string }).message).toBe(
        "action 'lost-mid-write' is unknown; recover that attempt before submitting another",
      );
    }),
  ));
