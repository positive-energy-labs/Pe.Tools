import { invokeCommand } from "./command-fixture.ts";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Fiber, Queue } from "effect";
import { expect, test } from "vite-plus/test";
import { takeoffEditKey, type ThreadHead } from "@pe/agent-contracts";
import { RevitBridgeLive } from "../src/bridge.ts";
import { admitCrossing, bindControl } from "../src/control.ts";
import { hostActionJournal } from "../src/gateway-owner.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { partitionFixture } from "./partition-fixture.ts";
import { approvedPea } from "./callers.ts";

// The socket is substituted. Admission, persisted Work, journal, FIFO and dispatch are production.
test.each(["guarded", "removed", "unchanged"] as const)(
  "queued native authority: %s preserves authored Work and the dispatched result",
  async (change) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { bridge, incoming, outgoing, target } = yield* connectTestBridge();
          const owner = hostActionJournal();
          const home = join(process.env.PE_TOOLS_PRODUCT_HOME!, randomUUID());
          yield* Effect.promise(() => mkdir(home, { recursive: true }));
          const fixture = yield* Effect.promise(() => partitionFixture(home, target));
          const before = yield* Effect.promise(() =>
            fixture.workspace.read(fixture.scope, "takeoffs"),
          );
          expect(before).toMatchObject({
            revision: 1,
            doc: {
              edits: {
                [takeoffEditKey("room-1", "name")]: { edit: { value: "Reviewed" } },
              },
            },
          });
          let full = true;
          let head: ThreadHead = {
            revision: 1,
            targets:
              change === "removed"
                ? [
                    {
                      request: { kind: "open", ref: target },
                      admission: { revision: 1, at: "2026-10-23T16:00:00Z", via: "local" },
                    },
                  ]
                : [],
          };
          bindControl({
            heads: () => head,
            acquired: () => null,
            acquiredSession: () => null,
            fullAccess: () => full,
          });
          const queued = Promise.withResolvers<void>();
          const op = `queued-${randomUUID()}`;
          const unsubscribe = owner.subscribe({}, (receipt) => {
            if (
              receipt.body.kind === "queue" &&
              receipt.body.op === op &&
              receipt.body.phase === "queued"
            )
              queued.resolve();
          });
          const answer = (requestId: string) =>
            Queue.offer(
              incoming,
              JSON.stringify({
                kind: "Response",
                response: {
                  requestId,
                  ok: true,
                  statusCode: 200,
                  payloadJson: '{"completed":true}',
                  openDocumentId: target.openId,
                  metrics: {
                    requestBytes: 0,
                    responseBytes: 0,
                    revitExecutionMs: 0,
                    roundTripMs: 0,
                    serializationMs: 0,
                  },
                },
              }),
            );
          try {
            const holder = yield* Effect.forkScoped(
              bridge.invoke("holder", {}, target.session, null),
            );
            const sent = yield* Queue.take(outgoing);
            const intent = fixture.intent(randomUUID());
            const caller = approvedPea();
            const basis = admitCrossing(caller, intent.target, "/actions");
            const action = yield* Effect.promise(() =>
              invokeCommand(
                owner,
                { ...intent, key: "test.queued-authority", caller, basis },
                async () => null,
                async (execution) =>
                  execution.step("native", op, {}, async (id) => {
                    const result = await Effect.runPromise(
                      Effect.result(bridge.invoke(op, {}, target.session, target.openId, id)),
                    );
                    if (result._tag === "Failure") throw result.failure;
                    return result.success.value;
                  }),
              ),
            );
            yield* Effect.promise(() => queued.promise);
            if (change === "guarded") full = false;
            if (change === "removed") head = { revision: 2, targets: [] };
            yield* answer(sent.request!.requestId);
            expect((yield* Fiber.join(holder)).value).toEqual({ completed: true });
            const next = yield* Queue.take(outgoing);
            expect(next.request?.operationKey).toBe(op);
            yield* answer(next.request!.requestId);
            const settled = yield* Effect.promise(() => owner.wait(action.id));
            expect(settled.state).toBe("succeeded");
            expect(admitCrossing(caller, intent.target, "/actions")).toBeNull();
            expect(yield* Queue.size(outgoing)).toBe(0);
            expect(
              yield* Effect.promise(() => fixture.workspace.read(fixture.scope, "takeoffs")),
            ).toEqual(before);
          } finally {
            unsubscribe();
            bindControl({
              heads: null,
              acquired: () => null,
              acquiredSession: () => null,
              fullAccess: () => false,
            });
          }
        }),
      ).pipe(Effect.provide(RevitBridgeLive)),
    );
  },
);
