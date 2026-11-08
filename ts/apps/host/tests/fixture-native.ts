import { Context, Effect, Exit, Layer, Queue, Scope } from "effect";
import type { BridgeStateSnapshot } from "@pe/host-contracts/contracts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import { createFixtureHost } from "../../../packages/host-contracts/src/fixture-host.ts";
import { RevitBridge, RevitBridgeLive } from "../src/bridge.ts";
import { HostReceipts } from "../src/gateway-owner.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { settle } from "./effect-test.ts";
import { gatewayNativeLeaves } from "../src/gateway-actions.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { DuctFiles } from "../src/ducts-files.ts";
import { HostDocumentMarks } from "../src/document-marks.ts";
import { PictureCaptureStore } from "../src/captures-route.ts";
import { SdkDriver } from "../src/sdk-session.ts";
import { serveRoutes } from "./real-server.ts";
import { mintContext, retireContext } from "../src/control.ts";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import type { Caller } from "@pe/agent-contracts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { join } from "node:path";
import { nativeRecordings } from "./native-recordings.ts";

const fetchRecorded = globalThis.fetch;

/** Socket adaptation only: all native replies and checks belong to the one fixture transport. */
export async function fixtureNative(
  directory: string,
  ...recordings: string[]
) {
  let selected = nativeRecordings(...recordings);
  const makeTransport = () => createFixtureHost(hostOpCatalog, selected.responses, { sources: selected.sources, actionLeaves(action) {
    if (action.startsWith("native:")) {
      const key = action.slice("native:".length);
      const op = hostOpCatalog.find(op => op.key === key);
      // A direct public native door is its generated leaf; a semantic action uses its real uses.
      return op && !op.internal ? [key] : undefined;
    }
    const declaration = linkedCatalog().entries.get(`command:${action}`);
    if (declaration) return declaration.uses.map(use => typeof use === "string" ? use : use.key);
    // A public native operation admitted as an action uses its own generated declaration.
    return hostOpCatalog.some(op => op.key === action && !op.internal) ? gatewayNativeLeaves(action) : undefined;
  } });
  let transport = makeTransport();
  const scope = Scope.makeUnsafe();
  const context = await settle(Layer.buildWithScope(
    RevitBridgeLive.pipe(Layer.provideMerge(HostReceipts.layer(null, directory))), scope,
  ));
  const actualBridge = Context.get(context, RevitBridge);
  let nextInventory: (() => Promise<void>) | undefined;
  const bridge = { ...actualBridge, list: Effect.suspend(() => {
    const pause = nextInventory; nextInventory = undefined;
    return pause ? Effect.promise(pause).pipe(Effect.andThen(actualBridge.list)) : actualBridge.list;
  }) };
  const journal = Context.get(context, HostReceipts).journal;
  let beforeReply: (key: string) => Promise<void> = async () => {};
  let emitDocumentChange: (() => Promise<void>) | undefined;
  const calls: { key: string; input: unknown; action: string | null | undefined }[] = [];
  const tokens = new Map<string, string>();
  const handlers: Promise<{ close(): Promise<void> }>[] = [];
  return {
    bridge, journal, calls,
    onRequest(listener: (key: string) => Promise<void>) { beforeReply = listener; },
    changeAfterPreparation(actionId: string, milliseconds: number) {
      let injected = false;
      // Observe a real durable preparation; inject only an incoming bridge event and inventory delay.
      const stop = journal.subscribe({ kinds: ["action"] }, receipt => {
        if (receipt.body.kind !== "action") return;
        const row = receipt.body.value;
        if (row.id !== actionId || row.prepared.state !== "ready" || injected) return;
        injected = true;
        nextInventory = async () => { await new Promise(resolve => setTimeout(resolve, milliseconds)); };
        if (!emitDocumentChange) throw Error("No connected recording transport");
        void emitDocumentChange();
      });
      return { injected: () => injected, stop };
    },
    get transport() { return transport; },
    select(...names: string[]) {
      const next = nativeRecordings(...names);
      selected = { responses: { ...selected.responses, ...next.responses }, sources: { ...selected.sources, ...next.sources } };
      transport = makeTransport();
    },
    actions(deps: Parameters<typeof makeCallRoute>[2] = {}, captures?: Parameters<typeof makeCallRoute>[1], composition: Parameters<typeof makeCallRoute>[3] = {}, routes: Layer.Layer<never, any, any> = Layer.empty) {
      const dependencies = { ...deps, sdk: deps.sdk ?? sdkSessions };
      const web = serveRoutes(Layer.mergeAll(routes, makeCallRoute(journal, captures, dependencies, composition)).pipe(
        Layer.provide(Layer.mergeAll(DuctFiles.layer(), HostDocumentMarks.layer)),
        Layer.provideMerge(PictureCaptureStore.layer(join(directory, "pictures"))),
      ), bridge, Layer.succeed(SdkDriver, args => Effect.promise(() => dependencies.sdk(args))));
      handlers.push(web);
      const request = async (req: Request, caller: Caller = { kind: "human", via: "local" }) => {
        const server = await web;
        const headers = new Headers(req.headers);
        const identity = JSON.stringify(caller);
        if (caller.kind !== "anonymous") {
          if (caller.kind !== "human" && caller.kind !== "pea" && caller.kind !== "external-mcp")
            throw Error(`Fixture needs a real browser identity for ${caller.kind}`);
          if (!tokens.has(identity)) tokens.set(identity, mintContext(caller.kind === "human" ? { ...caller, via: "cli" } : caller));
          headers.set(HOST_CONTEXT_HEADER, tokens.get(identity)!);
        }
        const url = new URL(req.url);
        return fetchRecorded(new Request(server.base + url.pathname + url.search, {
          method: req.method, headers, signal: req.signal,
          ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: await req.text() }),
        }));
      };
      return Object.assign((body: unknown, caller?: Caller) => request(new Request("http://host/actions", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }), caller), { request });
    },
    async connect(state: Partial<BridgeStateSnapshot> = {}, pid = 42) {
      const socket = await settle(connectTestBridge(pid, {}, state).pipe(
        Effect.provideService(RevitBridge, bridge), Effect.provideService(Scope.Scope, scope),
      ));
      emitDocumentChange = () => settle(Queue.offer(socket.incoming, JSON.stringify({ kind: "Event", event: {
        eventName: "document-changed", payloadJson: JSON.stringify({ changedOpenIds: [socket.target.openId] }),
      } })).pipe(Effect.asVoid));
      await settle(Effect.forkIn(Effect.gen(function* () {
        while (true) {
          const frame = yield* Queue.take(socket.outgoing);
          if (frame.kind !== "Request") continue;
          const req = frame.request!;
          const input: unknown = JSON.parse(req.payloadJson);
          calls.push({ key: req.operationKey, input, action: req.derivedCommand });
          yield* Effect.promise(() => beforeReply(req.operationKey));
          let response: object;
          try {
            // Effect-owned preparation reads can lack the ALS-derived command on the frame.
            // Use the real journal admission; refuse ambiguous concurrent command ownership.
            const active = req.derivedCommand ? [] : (yield* Effect.promise(() => journal.list())).filter(row => ["running", "queued", "waiting"].includes(row.state));
            const owners = [...new Set(active.map(row => row.key))];
            if (owners.length > 1) throw Error("Fixture cannot attribute this native read to one admitted action");
            const action = req.derivedCommand ?? owners[0] ?? `native:${req.operationKey}`;
            const value = transport.reply(action, req.operationKey, input);
            response = { ok: true, statusCode: 200, payloadJson: JSON.stringify(value) };
          } catch (error) {
            response = { ok: false, statusCode: 409, errorMessage: String(error) };
          }
          yield* Queue.offer(socket.incoming, JSON.stringify({ kind: "Response", response: {
            requestId: req.requestId, openDocumentId: req.openDocumentId,
            metrics: { requestBytes: 0, responseBytes: 0, revitExecutionMs: 0, roundTripMs: 0, serializationMs: 0 },
            ...response,
          } }));
        }
      }), scope));
      return socket;
    },
    close: async () => {
      for (const web of handlers) await (await web).close();
      for (const token of tokens.values()) retireContext(token);
      await settle(Scope.close(scope, Exit.void));
    },
  };
}
