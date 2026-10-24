import { Effect, Queue } from "effect";
import { expect, test } from "vite-plus/test";
import {
  TURN_ELEMENT_NAMES_LIMIT,
  turnElementNamesRequestSchema,
  type TurnElementNamesSnapshot,
} from "../../../packages/agent-contracts/src/turn-element-names.ts";
import {
  readTurnElementNames,
  type TurnElementNamesNativeRead,
} from "../src/turn-element-names.ts";
import { RevitBridgeLive } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { hostActionJournal } from "../src/gateway-owner.ts";

const a = { session: "original-process", openId: "original-document" };
const b = { session: "original-process", openId: "second-document" };
const snapshot: TurnElementNamesSnapshot = {
  thread: "thread",
  turnId: "turn",
  targets: [a, b],
  complete: true,
};
const request = (ids: number[]) => ({
  kind: "turn-element-names" as const,
  thread: "thread",
  turnId: "turn",
  ids,
});
const row = (elementId: number, name = `Name ${elementId}`) => ({
  elementId,
  name,
  elementUniqueId: `unique-${elementId}`,
});
function payload(ids: number[], entries: ReturnType<typeof row>[]) {
  return {
    queryKind: "ElementReferences",
    requestedElementCount: ids.length,
    resolvedElementCount: entries.length,
    entries,
    issues: ids
      .filter((id) => !entries.some((entry) => entry.elementId === id))
      .map(() => ({
        code: "ElementContextElementIdNotFound",
        severity: "Warning",
      })),
  };
}

// Only the socket/native payload is substituted. The service, registration, FIFO, frame
// decoding and exact open-document dispatch are production. This does not prove Revit behavior.
test("turn names batch exact pinned documents through the production bridge and keep ambiguity", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        hostActionJournal();
        const { bridge, outgoing, incoming, target } = yield* connectTestBridge();
        const other = { ...target, openId: "other-open" };
        const pinned = { ...snapshot, targets: [target, target, other] };
        const calls: string[] = [];
        const read: TurnElementNamesNativeRead = (op, input, ref) => {
          calls.push(ref.openId);
          return Effect.runPromise(bridge.invoke(op, input, ref.session, ref.openId));
        };
        const pending = readTurnElementNames(pinned, request([101, 101, 202, 303]), read);
        for (let index = 0; index < 2; index++) {
          const sent = (yield* Queue.take(outgoing)).request!;
          expect(sent.operationKey).toBe("revit.detail.elements");
          expect(JSON.parse(sent.payloadJson!)).toEqual({
            query: { kind: "ElementReferences", elementIds: [101, 202, 303] },
          });
          const entries = sent.openDocumentId === target.openId ? [row(101), row(202)] : [row(101)];
          yield* Queue.offer(
            incoming,
            JSON.stringify({
              kind: "Response",
              response: {
                requestId: sent.requestId,
                ok: true,
                statusCode: 200,
                openDocumentId: sent.openDocumentId,
                payloadJson: JSON.stringify(payload([101, 202, 303], entries)),
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
        }
        const observed = yield* Effect.promise(() => pending);
        expect(calls).toEqual([target.openId, other.openId]);
        expect(observed.entries).toEqual([
          { state: "ambiguous", elementId: 101 },
          { state: "resolved", elementId: 202, target, uniqueId: "unique-202", name: "Name 202" },
          { state: "unresolved", elementId: 303, reason: "missing" },
        ]);
        // A log round-trip retains identity and avoids reads, even after the model changes.
        const saved = JSON.parse(JSON.stringify(observed));
        const replay = yield* Effect.promise(() =>
          readTurnElementNames(pinned, request([101, 202, 303]), read, saved),
        );
        expect(replay.entries).toEqual(observed.entries);
        expect(calls).toHaveLength(2);
        expect(yield* Queue.size(outgoing)).toBe(0);
      }),
    ).pipe(Effect.provide(RevitBridgeLive)),
  );
});

test.each(["closed", "replacement", "collector-failed", "unexpected-id", "long-name"])(
  "%s cannot turn a partial census into a unique name",
  async (fault) => {
    const read: TurnElementNamesNativeRead = async (_op, input, ref) => {
      if (ref.openId === b.openId && fault === "closed") throw Error("document closed");
      const value = payload(input.query!.elementIds!, [row(101)]);
      if (ref.openId === b.openId) {
        if (fault === "collector-failed")
          value.issues.push({ code: "ElementContextCollectFailed", severity: "Warning" });
        if (fault === "unexpected-id") value.entries = [row(999)];
        if (fault === "long-name") value.entries = [row(101, "x".repeat(513))];
      }
      return {
        value,
        target: {
          documentRef: {
            ...ref,
            openId:
              ref.openId === b.openId && fault === "replacement" ? "reopened-document" : ref.openId,
          },
        },
      };
    };
    const result = await readTurnElementNames(snapshot, request([101]), read);
    expect(result.entries).toEqual([
      { state: "unresolved", elementId: 101, reason: "read-unavailable" },
    ]);
  },
);

test("incomplete pins, replacement targets, and bounded cumulative ids fail closed", async () => {
  let calls = 0;
  const read: TurnElementNamesNativeRead = async (_op, input, ref) => {
    calls++;
    return { value: payload(input.query!.elementIds!, []), target: { documentRef: { ...ref } } };
  };
  const incomplete = await readTurnElementNames(
    { ...snapshot, complete: false },
    request([101]),
    read,
  );
  expect(incomplete.entries).toEqual([
    { state: "unresolved", elementId: 101, reason: "targets-unpinned" },
  ]);
  expect(calls).toBe(0);
  expect(turnElementNamesRequestSchema.safeParse({ ...request([101]), target: b }).success).toBe(
    false,
  );
  const previous = await readTurnElementNames(
    snapshot,
    request(Array.from({ length: TURN_ELEMENT_NAMES_LIMIT }, (_, i) => i + 1)),
    read,
  );
  await expect(readTurnElementNames(snapshot, request([999]), read, previous)).rejects.toThrow(
    "at most 256",
  );
  await expect(
    readTurnElementNames(
      { ...snapshot, targets: [{ ...a, session: "new-process" }] },
      request([101]),
      read,
      previous,
    ),
  ).rejects.toThrow("cannot be rebound");
  await expect(
    readTurnElementNames(snapshot, { ...request([101]), turnId: "other-turn" }, read),
  ).rejects.toThrow("pinned targets");
  expect(calls).toBe(2);
});
