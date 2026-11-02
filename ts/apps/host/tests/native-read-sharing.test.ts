/**
 * Revit runs one op at a time, so a native Read at /call is one turn of a serial queue. An
 * identical caller that arrives while it runs (a browser resubscribe, a retry) joins it rather
 * than queueing its twin, and a read every caller abandoned is cancelled rather than run to
 * completion for nobody. The bridge here is a stand-in that never answers the read on its own,
 * so "joined", "not interrupted" and "cancelled" are assertions, not timing inferences.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Deferred, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge, type HostBridgeEvent } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { asCaller, human } from "./callers.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";

const KEY = "revit.detail.space-scene";
const target = { session: "bridge-a", openId: "open-a" };

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "pe-native-read-"));
  const reads: { requestId: string; input: unknown; interrupted: boolean; answer: () => void }[] =
    [];
  const cancels: string[] = [];
  const listeners = new Set<(event: HostBridgeEvent) => void>();
  const bridge = {
    list: Effect.succeed([
      {
        connected: true,
        sessionId: target.session,
        sdkSessionId: "dev",
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: {
          openDocuments: [
            {
              openId: target.openId,
              address: "C:/HVAC.rvt",
              title: "HVAC",
              isFamilyDocument: false,
            },
          ],
        },
      },
    ]),
    subscribe: (listener: (event: HostBridgeEvent) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    invoke: (
      key: string,
      input: unknown,
      _session?: string,
      _open?: string,
      requestId?: string,
    ) => {
      if (key === "host.ops.catalog")
        return Effect.succeed({
          value: { operations: [{subject:"None",touches:"Metadata",effect:"Read",cardinality:"One",costTier:"Cheap", key: KEY, intent: "Read", needs: "project-document" }] },
          target: null,
        });
      if (key === "op.cancel")
        return Effect.sync(() => {
          const named = (input as { requestId: string }).requestId;
          cancels.push(named);
          reads.find((read) => read.requestId === named)?.answer();
          return { value: { cancelled: true, requestId: named }, target: null };
        });
      return Effect.gen(function* () {
        const done = yield* Deferred.make<void>();
        const read = {
          requestId: requestId!,
          input,
          interrupted: false,
          answer: () => Deferred.doneUnsafe(done, Effect.void),
        };
        reads.push(read);
        yield* Deferred.await(done).pipe(
          Effect.onInterrupt(() => Effect.sync(() => void (read.interrupted = true))),
        );
        return {
          value: { id: `artifact-${reads.indexOf(read)}` },
          target: { session: target.session, document: "C:/HVAC.rvt", documentRef: target },
        };
      });
    },
  } as unknown as RevitBridge["Service"];
  const web = HttpRouter.toWebHandler(
    makeCallRoute(
      new ActionJournal(join(dir, "journal.jsonl")),
      undefined,
      { sdk: sdkSessions },
      {
        forwardBase: null,
        dispatch: () => Effect.die("No TS-only calls expected"),
        captureHostOp: () => {},
      },
    ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
    { disableLogger: true },
  );
  const post = (request: unknown, signal?: AbortSignal) =>
    asCaller(human, web.handler)(
      new Request("http://host/call", {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          [HOST_RPC_BRIDGE_SESSION_HEADER]: target.session,
          [HOST_RPC_DOCUMENT_HEADER]: target.openId,
        },
        body: JSON.stringify({ key: KEY, request }),
      }),
      Context.empty() as never,
    );
  const until = async (ready: () => boolean) => {
    for (let turn = 0; turn < 200 && !ready(); turn++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(ready()).toBe(true);
  };
  return {
    reads,
    cancels,
    post,
    until,
    dispose: async () => {
      await web.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const scene = { elementIds: [7199], focusOnly: false, contextRepresentation: "meshes" };

test("an identical native read joins the one in flight instead of queueing behind it", async () => {
  const { reads, post, until, dispose } = await harness();
  try {
    const first = post(scene);
    await until(() => reads.length === 1);
    const second = post(scene);
    const other = post({ ...scene, contextRepresentation: "boxes" });
    await until(() => reads.length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads.map((read) => read.input)).toEqual([
      scene,
      { ...scene, contextRepresentation: "boxes" },
    ]);
    for (const read of reads) read.answer();
    const [a, b] = await Promise.all([first, second, other]);
    expect(a!.status, await a!.clone().text()).toBe(200);
    expect(await b!.json()).toEqual(await a!.json());
    expect(b!.headers.get("x-pe-native-request-id")).toBe(reads[0]!.requestId);
  } finally {
    await dispose();
  }
});

test("a read its only caller abandoned is cancelled in Revit, and a later ask reads afresh", async () => {
  const { reads, cancels, post, until, dispose } = await harness();
  try {
    const abort = new AbortController();
    const abandoned = post(scene, abort.signal).catch(() => null);
    await until(() => reads.length === 1);
    abort.abort();
    await until(() => cancels.length === 1);
    expect(cancels).toEqual([reads[0]!.requestId]);
    // The bridge turn itself is not interrupted: the FIFO gate is held until Revit answers.
    expect(reads[0]!.interrupted).toBe(false);
    await abandoned;
    const again = post(scene);
    await until(() => reads.length === 2);
    reads[1]!.answer();
    expect((await again).status).toBe(200);
  } finally {
    await dispose();
  }
});

test("a joined read survives one caller leaving and is cancelled only when the last leaves", async () => {
  const { reads, cancels, post, until, dispose } = await harness();
  try {
    const leaving = new AbortController();
    const staying = post(scene);
    await until(() => reads.length === 1);
    const gone = post(scene, leaving.signal).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    leaving.abort();
    await gone;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancels).toEqual([]);
    reads[0]!.answer();
    expect((await staying).status).toBe(200);
    expect(reads).toHaveLength(1);
  } finally {
    await dispose();
  }
});
