
import { HostNativeRead } from "@pe/host-internal/native-read";
import { NativeReads } from "../src/native-reads.ts";


import { testDuctFiles } from "./effect-test.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeCrypto } from "@effect/platform-node";
import { Context, Effect, Exit, Layer, Scope } from "effect";

import { TestClock } from "effect/testing";
import { bindWork, NATIVE_BODY_VERSION_HEADER, type Address, type Caller } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { RouteWorkspace } from "@pe/runtime";
import type { ResourceObserver } from "../../../packages/runtime/src/resource-stream.ts";


import { settle } from "./effect-test.ts";

import { sdkSessions } from "./native-receipt-fixture.ts";
import { RevitBridge, BridgeError } from "../src/bridge.ts";


import { admittedBuiltinsLayer } from "../src/admitted-builtins.ts";
import { RunConsents, runConsentsPromise, type ConsentEvent } from "../src/run-consent.ts";
import { bindControl } from "../src/control.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import type { ReadSources } from "../src/reads/inputs.ts";
import { Publications } from "../src/reads/evaluator.ts";
import { graphRoute } from "../src/reads/routes.ts";
import { sheetPort } from "./ducts-read.fixture.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { createPeRoutes } from "../src/pe-routes.ts";

import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { SdkSession, SdkDriver } from "../src/sdk-session.ts";


import { fixtureNative } from "./fixture-native.ts";
import { captureStore } from "./effect-test.ts";
/** Recorded bridge data only; Work, admission, seals and consent run in the host. */
export async function nativeFixture(
  clockMode: "real" | "test" = "real",
  _recordings?: undefined,
  address: Address | null = null,
) {
  const scope = Scope.makeUnsafe();
  const dir = await mkdtemp(join(tmpdir(), "fans-recorded-"));
  const saved = new RouteWorkspace({ registrations: [], store: fileRouteDocumentStore(join(dir, "work")) });
  const context = await settle(Layer.buildWithScope(Layer.mergeAll(admittedBuiltinsLayer(saved),
    RunConsents.layer.pipe(Layer.provide(NodeCrypto.layer))), scope));
  const clock = clockMode === "test" ? await settle(Layer.buildWithScope(TestClock.layer(), scope)) : Context.empty();
  const consent = Context.get(context, RunConsents);
  const runs = runConsentsPromise({ ...consent, authorize: (...args: Parameters<typeof consent.authorize>) => consent.authorize(...args).pipe(Effect.provide(clock)) });
  const events: ConsentEvent[] = [];
  runs.attach({ emit: (_run, event) => events.push(event), persist() {}, autoApprove: () => true });
  bindControl({ runs });
  const transport = await fixtureNative(join(dir, "native"), "driver-ducts.snapshot.walk", "driver-ducts.snapshot.roster",
    "driver-ducts.tables", "driver-revit.catalog.field-options", "fans-accessory-initial", "sdk-ducts.apply", "driver-op.cancel");
  const bridge = transport.bridge, journal = transport.journal;
  const captures = captureStore(join(dir, "captures"));
  const connection = await transport.connect();
  const target = { kind: "document" as const, ref: connection.target };
  const key = bindWork("ducts", address, undefined, target.ref);
  const rootReads: { native?: HostNativeRead["Service"]; shared?: NativeReads["Service"] } = {};
  const sdkInput = { read: sdkSessions };
  const http = transport.actions({ workspace: saved, sdk: args => sdkInput.read(args), files: testDuctFiles() }, undefined, {}, Layer.effectDiscard(Effect.gen(function* () {
    rootReads.native = yield* HostNativeRead; rootReads.shared = yield* NativeReads;
  })));
  const request = http.request;
  const post = (path: string, body: unknown, caller?: Caller) => request(new Request(`http://fixture${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), caller);
  const readPause = { key: "", wait: Effect.void };
  transport.onRequest(async key => { if (key === readPause.key) await settle(readPause.wait); });
    const sdkContext = await settle(
      Layer.buildWithScope(
        SdkSession.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(RevitBridge, bridge),
              Layer.succeed(SdkDriver, (args) => Effect.promise(() => sdkSessions(args))),
            ),
          ),
        ),
        scope,
      ),
    );
    const sdk = Context.get(sdkContext, SdkSession);
    const observeHostResource: ResourceObserver = hostResourceObserver(
      bridge,
      () => journal,
      () => captures,
      "http://fixture",
      (url, init) => request(new Request(url, init)),
      undefined,
      (_bridge, scope) =>
        sdk.resolve(scope).pipe(
          Effect.mapError((error) => new BridgeError(error.message, error.status)),
          Effect.provideService(
            RequestIdentity,
            admittedRequestIdentity({ kind: "human", via: "local" }, scope),
          ),
        ),
    );
    const readDucts: ReadSources["call"] = (op, input, raw, version) => {
      const ref="kind" in raw ? raw.kind === "document"?raw.ref:null : raw;
      if(!ref) throw Error("Fixture requires a document target");
      return request(
        new Request("http://fixture/call", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [HOST_RPC_BRIDGE_SESSION_HEADER]: ref.session,
            [HOST_RPC_DOCUMENT_HEADER]: ref.openId,
            ...(version && { [NATIVE_BODY_VERSION_HEADER]: version }),
          },
          body: JSON.stringify({ key: op, request: input }),
        }),
      );
    };
    const publications = new Publications();
    const api = createPeRoutes({
      workspace: saved,
      registrations: [],
      store: fileRouteDocumentStore(join(dir, "work")),
      heads: { observe: () => () => {} },
      navigation: {
        threads: async () => [],
        documents: async () => [{ ...target.ref, address }],
      },
      readGraph: async raw => {
        const port = sheetPort({ firm: (owner) => settle(testDuctFiles().firm(owner)), catalogs: () => settle(testDuctFiles().ductCatalogs), call: readDucts,
          workKey: async ref => bindWork("ducts", address, undefined, ref) }, saved);
        const graph = graphRoute("reads.value", raw);
        return graph.publish(publications, graph.publication!.subscription, graph.publication!.generation, port);
      },
      observeHostResource,
    });
  return {
    api, dir, target, key, saved, journal, runs, events, rootReads, sdkInput, readPause,
    dispatched: transport.calls, readDucts, observeHostResource, post, request,
    select: (...names: string[]) => transport.select(...names),
    advance: (milliseconds: number) => settle(TestClock.adjust(milliseconds).pipe(Effect.provide(clock))),
    async close() {
      runs.closeAll();
      for (const row of await journal.list()) if (["running", "waiting", "queued"].includes(row.state)) await journal.cancel(row.id);
      await transport.close();
      await settle(Scope.close(scope, Exit.void));
      bindControl({ runs: undefined });
      await rm(dir, { recursive: true, force: true });
    },
  };
}
