import { testHostInputs } from "./effect-test.ts";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { Layer, Effect, Fiber, Queue, Schema } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { tsOnlyOperationSchemas } from "@pe/host-contracts/operation-types";
import { bindWork, tools, type ActionAdmission } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { HOST_CONTEXT_HEADER, type BridgeFrame } from "@pe/host-contracts/contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridgeLive, RevitProcessAlive } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { bindControl, mintContext, retireContext } from "../src/control.ts";
import { HostReceipts } from "../src/gateway-owner.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { productPodsRootPath } from "../src/product-paths.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { testConsents } from "./effect-test.ts";
import { originalProcess, sdkSessions } from "./native-receipt-fixture.ts";
import { replay } from "./sdk-replay.ts";
import { serveRoutes } from "./real-server.ts";

// The socket and SDK stdout are external inputs. Command metadata, preparation, permissions,
// queue receipts, dispatch evidence and recovery all belong to the production HTTP runtime.
test("cold command admission, native outcomes, recovery and root Stop cross the actual bridge wire", ({
  signal,
}) => {
  const life = { alive: true };
  // effect-edge: test-runner
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { journal: owner } = yield* HostReceipts;
        const { bridge, incoming, outgoing, target, connection } = yield* connectTestBridge();
        const native = yield* Queue.make<NonNullable<BridgeFrame["request"]>>();
        const sent: NonNullable<BridgeFrame["request"]>[] = [];
        const key = "revit.context.lens";
        const value = nativeResponseSchema("revit.context.lens").parse({
          viewId: 101,
          viewName: "Pe lens",
          created: true,
          boxed: 1,
          note: "Boxed element 11",
        });
        const metrics = {
          requestBytes: 0,
          responseBytes: 0,
          revitExecutionMs: 0,
          roundTripMs: 0,
          serializationMs: 0,
        };
        const reply = (requestId: string, payload: unknown, statusCode = 200, code?: string) =>
          Queue.offer(
            incoming,
            JSON.stringify({
              kind: "Response",
              response: {
                requestId,
                ok: statusCode < 300,
                statusCode,
                payloadJson: JSON.stringify(payload),
                metrics,
                errorMessage: statusCode >= 300 ? "native response" : undefined,
                issues: code
                  ? [
                      {
                        instancePath: "$",
                        code,
                        message: code,
                        severity: "error",
                        schemaPath: null,
                        suggestion: null,
                      },
                    ]
                  : undefined,
              },
            }),
          );
        let catalogReads = 0;
        const responder = yield* Effect.forkScoped(
          Effect.forever(
            Effect.gen(function* () {
              const frame = yield* Queue.take(outgoing);
              if (!frame.request) throw Error("Expected host Request frame");
              const request = frame.request;
              if (request.operationKey === "host.ops.catalog") {
                catalogReads++;
                yield* reply(request.requestId, { operations: hostOpCatalog });
              } else {
                sent.push(request);
                yield* Queue.offer(native, request);
              }
            }),
          ),
        );
        const reads: string[][] = [];
        let confirmed = false;
        let receiptPid = originalProcess.pid;
        let bindRead: (() => Promise<void>) | undefined;
        const sdk = async (args: readonly string[]) => {
          if (args[0] === "doc") await bindRead?.();
          if (args[0] !== "op") return sdkSessions(args);
          reads.push([...args]);
          if (!confirmed)
            return replay("op-result", {
              result: { state: "running", requestId: args[2], receipt: null },
            });
          return replay("op-result", {
            result: {
              state: "ok",
              requestId: args[2],
              receipt: {
                requestId: args[2],
                key,
                pid: receiptPid,
                processStartUtc: originalProcess.processStartUtc,
                verdict: "ok",
              },
              response: value,
            },
          });
        };
        const root = { thread: "wire-root", turn: "root-turn" };
        const child = { thread: "wire-child", turn: "child-turn" };
        const asks: string[] = [];
        const runs = testConsents((run, event) => {
          if (event.kind === "permission_request") {
            asks.push(event.requestId);
            queueMicrotask(() => runs.decide(run.thread, event.requestId, "allow_now"));
          }
        });
        runs.open(root);
        runs.open(child, root);
        bindControl({ runs, acquired: () => null });
        const human = mintContext({ kind: "human", via: "cli" });
        const pea = mintContext({ kind: "pea", thread: child.thread, run: child, root });
        const workspace = new RouteWorkspace({
          registrations: [{ spec: tools.families.work }],
          store: fileRouteDocumentStore(join(hostOwnership.rootPath, "wire-work")),
        });
        const podsRoot = productPodsRootPath();
        const server = yield* Effect.promise(() =>
          serveRoutes(makeCallRoute(owner, undefined, { sdk, workspace, podsRoot }).pipe(Layer.provide(testHostInputs)), bridge),
        );
        yield* Effect.promise(async () => {
          const post = async (path: string, body: unknown, token = human) => {
            const response = await fetch(server.base + path, {
              method: "POST",
              signal,
              headers: {
                "content-type": "application/json",
                [HOST_CONTEXT_HEADER]: token,
              },
              body: JSON.stringify(body),
            });
            const text = await response.text();
            expect(response.status, text).toBeLessThan(300);
          };
          const admission = (
            id: string,
            input: Record<string, unknown> = { elementIds: [11] },
          ): ActionAdmission => ({ id, key, target: { kind: "document", ref: target }, input });
          const nextRequest = (id: string) =>
            Promise.race([
              Effect.runPromise(Queue.take(native), { signal }),
              owner.wait(id).then((row) => {
                throw Error(`Action ${id} ended before native Request: ${JSON.stringify(row)}`);
              }),
            ]);
          let releaseFault = () => {};
          let closed = false;
          try {
            // A real cold catalog read journals through this same owner during definition/bind.
            await post("/actions", admission("invalid", { unexpectedProperty: true }));
            expect(await owner.wait("invalid")).toMatchObject({
              state: "failed",
              notDispatched: true,
              error: expect.stringContaining("Invalid native input"),
            });
            expect(catalogReads).toBe(1);
            expect(sent).toHaveLength(0);
            // Families capture has two actual effects: native capture, then a create-only member write.
            await mkdir(join(podsRoot, "wire"), { recursive: true });
            await writeFile(
              join(podsRoot, "wire", "pod.json"),
              JSON.stringify({ id: "wire", version: "1.0.0", entrypoints: [] }),
            );
            const work = bindWork("families", null, undefined, target);
            const staged = await workspace.apply(
              work,
              "families",
              "human",
              [
                {
                  path: ["writeIntent", "families.capture"],
                  value: { edit: { value: { pod: "wire", familyIds: [1] } } },
                },
              ],
              0,
            );
            if (!staged.ok) throw Error(JSON.stringify(staged));
            const bindingCapture = {
              id: "binding",
              key: "families.capture",
              target: { kind: "document", ref: target },
              input: { work: { key: work, revision: staged.revision } },
            };
            for (const succeeds of [true, false]) {
              const id = succeeds ? "committed" : "failed";
              const binding = Promise.withResolvers<void>(),
                dispatched = Promise.withResolvers<void>();
              const mark = owner.markDispatched.bind(owner);
              const heldMark = succeeds
                ? vi.spyOn(owner, "markDispatched").mockImplementation(async (requestId) => {
                    await binding.promise;
                    await mark(requestId);
                    dispatched.resolve();
                  })
                : undefined;
              releaseFault = () => {
                binding.resolve();
                heldMark?.mockRestore();
              };
              await post("/actions", admission(id));
              const request = await nextRequest(id);
              expect(request.operationKey).toBe(key);
              expect(JSON.parse(request.payloadJson!)).toEqual({ elementIds: [11] });
              if (succeeds) {
                bindRead = async () => {
                  binding.resolve();
                  await dispatched.promise;
                };
                try {
                  await post("/actions", bindingCapture);
                } finally {
                  releaseFault();
                  bindRead = undefined;
                }
              }
              await expect
                .poll(async () => (await owner.list(undefined, id))[0]!.steps[0])
                .toMatchObject({
                  state: "running",
                  process: originalProcess,
                  dispatchedAt: expect.any(String),
                });
              await Effect.runPromise(reply(request.requestId, value, succeeds ? 200 : 422));
              expect((await owner.wait(id)).steps[0]).toMatchObject({
                state: succeeds ? "succeeded" : "failed",
                process: originalProcess,
                dispatchedAt: expect.any(String),
              });
              if (succeeds) {
                const bound = await nextRequest("binding");
                expect(bound.operationKey).toBe("families.capture");
                await Effect.runPromise(reply(bound.requestId, { families: [], diagnostics: [] }));
                expect((await owner.wait("binding")).state).toBe("succeeded");
              }
            }
            await post("/actions", admission("lost"));
            const lost = await nextRequest("lost");
            await Effect.runPromise(reply(lost.requestId, null, 423, "AbandonedStillRunning"));
            expect((await owner.wait("lost")).state).toBe("unknown");
            const beforeRecovery = sent.length;
            await post("/actions/resume", { id: "lost" });
            expect((await owner.wait("lost")).state).toBe("unknown");
            expect(reads).toHaveLength(1);
            expect(sent).toHaveLength(beforeRecovery);
            // Revit's terminal answer frees its line independently of the failed caller.
            await Effect.runPromise(reply(lost.requestId, value));
            confirmed = true;
            receiptPid = 43;
            await post("/actions/recover", { id: "lost" });
            expect((await owner.wait("lost")).state).toBe("unknown");
            receiptPid = originalProcess.pid;
            await post("/actions/recover", { id: "lost" });
            const recovered = await owner.wait("lost");
            expect(recovered.state).toBe("succeeded");
            expect(recovered.steps).toMatchObject([{ state: "succeeded", result: value }]);
            const recoveredReads = reads.length;
            await post("/actions/recover", { id: "lost" });
            await post("/actions/resume", { id: "lost" });
            expect(reads).toHaveLength(recoveredReads);
            expect(sent).toHaveLength(beforeRecovery);
            for (const args of reads) {
              expect(args).toContain(lost.requestId);
              expect(args).toContain(String(originalProcess.pid));
              expect(args).toContain(originalProcess.processStartUtc);
              expect(args).toContain(key);
            }
            const capture = { ...bindingCapture, id: "child-commit" };
            await post("/actions", capture, pea);
            const committed = await nextRequest("child-commit");
            expect(committed.operationKey).toBe("families.capture");
            await expect
              .poll(
                async () =>
                  (await owner.list(undefined, "child-commit"))[0]!.steps[0]?.dispatchedAt,
              )
              .toEqual(expect.any(String));
            await post("/actions", admission("child-next"), pea);
            await expect
              .poll(async () => (await owner.list(undefined, "child-next"))[0]!.steps.length)
              .toBe(1);
            expect(sent).toHaveLength(beforeRecovery + 1);
            runs.close(root, "stopped");
            const captured = {
              families: [{ familyId: 1, success: true, modelJson: "{}" }],
              diagnostics: [],
            };
            await Effect.runPromise(reply(committed.requestId, captured));
            const stopped = await owner.wait("child-commit");
            expect(stopped.state).toBe("cancelled");
            expect(stopped.steps).toMatchObject([
              {
                key: "families.capture",
                state: "succeeded",
                result: captured,
                dispatchedAt: expect.any(String),
              },
              { key: "pod.member.write", state: "cancelled" },
            ]);
            expect(stopped.steps[1]).not.toHaveProperty("dispatchedAt");
            const member = Schema.decodeUnknownSync(
              tsOnlyOperationSchemas["pod.member.write"].request,
            )(stopped.steps[1]!.input);
            await expect(access(join(podsRoot, "wire", member.path))).rejects.toMatchObject({
              code: "ENOENT",
            });
            const next = await owner.wait("child-next");
            expect(next.state, JSON.stringify(next)).toBe("cancelled");
            expect(next.steps.every((step) => !step.dispatchedAt)).toBe(true);
            expect(sent).toHaveLength(beforeRecovery + 1);
            expect(asks).toHaveLength(1);
            // Durable readback retains the native process/result, not a test-authored journal row.
            const persisted = new ActionJournal(
              join(
                hostOwnership.rootPath,
                "state",
                "host",
                hostOwnership.serviceName,
                "partition-operations.json",
              ), Date.now,
            );
            expect((await persisted.list(undefined, "lost"))[0]!.steps[0]).toMatchObject({
              state: "succeeded",
              process: originalProcess,
              result: value,
              dispatchedAt: expect.any(String),
            });
            await persisted.close();
            // Closing joins the actual native dispatch and refuses admissions before the final flush.
            await post("/actions", admission("shutdown"));
            const held = await nextRequest("shutdown");
            const closing = owner.close().then(() => {
              closed = true;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(closed).toBe(false);
            await expect(
              owner.invoke(admission("late"), {
                caller: { kind: "human", via: "local" },
                basis: null,
              }),
            ).rejects.toMatchObject({ refusal: { code: "host-stopping" } });
            await Effect.runPromise(reply(held.requestId, value));
            await closing;
            expect((await owner.wait("shutdown")).state).toBe("succeeded");
            await expect(
              owner.recordQueue(key, "late-queue", target.session, "started", 1),
            ).rejects.toThrow("closed");
          } finally {
            releaseFault();
            runs.closeAll();
            retireContext(human);
            retireContext(pea);
            await server.close();
            life.alive = false;
            await Effect.runPromise(Fiber.interrupt(connection));
            await Effect.runPromise(Fiber.interrupt(responder));
            if (!closed) await owner.close();
          }
        });
      }),
    ).pipe(
      Effect.provide(RevitBridgeLive),
      Effect.provide(HostReceipts.layer(null)),
      Effect.provideService(RevitProcessAlive, () => life.alive),
    ),
    { signal },
  );
}, 30_000);
