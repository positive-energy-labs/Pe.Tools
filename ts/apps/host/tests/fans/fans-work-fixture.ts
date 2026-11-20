import { stateFixture } from "../../../../tests/isolated-home/storage.ts";
import { mkdtemp } from "../../../../tests/isolated-home/storage.ts";
import { actAs } from "../callers.ts";
import { nativeReadRoot } from "../../src/app.ts";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { NativeReads } from "../../src/native-reads.ts";
import type { RequestIdentityData } from "@pe/host-internal/request-contracts";
import { testHostInputs, journalAt, callRouteOver } from "../effect-test.ts";
import { testDuctFiles } from "../effect-test.ts";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeCrypto, NodeServices, NodeHttpClient } from "@effect/platform-node";
import { Context, Effect, Exit, Layer, Queue, Scope } from "effect";
import { HttpRouter } from "effect/http";
import { TestClock } from "effect/testing";
import {
  bindWork,
  NATIVE_BODY_VERSION_HEADER,
  type Address,
  type Caller,
} from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { RouteWorkspace } from "@pe/runtime";
import type { ResourceObserver } from "@pe/runtime/resource-stream";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { settle } from "../effect-test.ts";
import { connectTestBridge } from "../bridge-fixture.ts";
import { ActionJournalService } from "../../src/receipt-services.ts";
import { sdkSessions } from "../native-receipt-fixture.ts";
import { RevitBridge, BridgeError } from "@pe/host-internal/bridge";
import { RevitBridgeLive } from "../../src/bridge.ts";
import { admittedBuiltinsLayer } from "../../src/admitted-builtins.ts";
import { RunRegistry } from "../../src/run-registry.ts";
import { bindControl, currentCaller, workAuthorOf } from "../../src/control.ts";
import { hostResourceObserver } from "../../src/resource-adapters.ts";
import type { ReadSources } from "../../src/reads/inputs.ts";
import { Publications } from "../../src/reads/publications.ts";
import { graphRoute } from "../../src/reads/routes.ts";
import { calcPort } from "../ducts/ducts-read.fixture.ts";
import { fileRouteDocumentStore } from "../../src/route-document-store.ts";
import { createPeRoutes } from "../../src/pe-routes.ts";
import { CaptureStore } from "../../src/takeoff-captures.ts";
import { RequestIdentity, admittedRequestIdentity } from "@pe/host-internal/request-identity";
import { readSessionScope, SdkSession, SdkDriver } from "../../src/sdk-session.ts";
import { snapshot } from "@pe/ducts-domain/test-fixture";

/** Only the native socket and SDK observation are substituted. Work, seals and the run registry are real. */
export async function nativeFixture(
  clockMode: "real" | "test" = "real",
  snapshotFor: (key: string, input: Record<string, any>) => DuctSnapshot = () => snapshot,
  address: Address | null = null,
  /** Another route's lane over the same doors: its open documents, its Pod deps, its native answers. */
  options: {
    state?: Parameters<typeof connectTestBridge>[2];
    deps?: Parameters<typeof callRouteOver>[2];
    native?: (key: string, input: Record<string, any>) => unknown;
    routes?: Layer.Layer<
      never,
      never,
      | RevitBridge
      | ActionJournalService
      | HttpRouter.HttpRouter
      | HttpRouter.Request<
          "Requires",
          import("@pe/host-internal/request-contracts").RequestIdentity
        >
      | HttpRouter.Request<"Error", unknown>
    >;
  } = {},
) {
  const scope = Scope.makeUnsafe();
  const home = process.env.LOCALAPPDATA ?? tmpdir();
  await mkdir(home, { recursive: true });
  const dir = await mkdtemp(join(home, "fans-native-"));
  try {
    const saved = new RouteWorkspace({
      publicationAuthor: () => workAuthorOf(currentCaller()),
      registrations: [],
      store: fileRouteDocumentStore(stateFixture(join(dir, "work"))),
    });
    const context = await settle(
      Layer.buildWithScope(
        Layer.mergeAll(
          admittedBuiltinsLayer(saved),
          RunRegistry.layer.pipe(Layer.provide(NodeCrypto.layer)),
          RevitBridgeLive.pipe(
            Layer.provide(
              ActionJournalService.live(null, stateFixture(join(dir, "bridge-receipts"))),
            ),
          ),
          CaptureStore.layer(stateFixture(join(dir, "captures"))),
        ),
        scope,
      ),
    );
    const clock =
      clockMode === "test"
        ? await settle(Layer.buildWithScope(TestClock.layer(), scope))
        : Context.empty();
    const runs = Context.get(context, RunRegistry);
    bindControl({ runs });
    const actualBridge = Context.get(context, RevitBridge);
    const nativeCallers: RequestIdentityData[] = [];
    const bridge: RevitBridge["Service"] = {
      ...actualBridge,
      invokeHandle: (...args) =>
        Effect.gen(function* () {
          const identity = yield* Effect.serviceOption(RequestIdentity);
          if (identity._tag === "None")
            throw Error("Native dispatch lost its actual caller identity");
          nativeCallers.push(identity.value);
          return yield* actualBridge.invokeHandle(...args);
        }),
    };
    const connection = await settle(
      connectTestBridge(42, {}, options.state).pipe(
        Effect.provideService(RevitBridge, bridge),
        Effect.provideService(Scope.Scope, scope),
      ),
    );
    const target = { kind: "document" as const, ref: connection.target };
    const key = bindWork("duct-systems", address, undefined, target.ref);
    const journal = journalAt(join(dir, "actions.jsonl"), Date.now);
    const rootReads: { native?: HostNativeRead["Service"]; shared?: NativeReads["Service"] } = {};
    const sdkInput = { read: sdkSessions };
    const web = HttpRouter.toWebHandler(
      Layer.mergeAll(
        callRouteOver(
          journal,
          Context.get(context, CaptureStore),
          { sdk: sdkSessions, workspace: saved, ...options.deps },
          {},
        ),
        (options.routes ?? Layer.empty).pipe(
          Layer.provide(Layer.succeed(ActionJournalService, journal)),
        ),
        Layer.effectDiscard(
          Effect.gen(function* () {
            rootReads.native = yield* HostNativeRead;
            rootReads.shared = yield* NativeReads;
          }),
        ),
      )
        .pipe(
          nativeReadRoot(
            Layer.succeed(SdkDriver, (args) => Effect.promise(() => sdkInput.read(args))),
          ),
        )
        .pipe(Layer.provide(testHostInputs))
        .pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              Layer.succeed(RevitBridge, bridge),
              NodeServices.layer,
              NodeHttpClient.layerUndici,
            ),
          ),
        ),
      { disableLogger: true },
    );
    const request = (request: Request, caller: Caller = { kind: "human", via: "local" }) =>
      actAs(caller, () =>
        web.handler(
          request,
          Context.make(
            RequestIdentity,
            admittedRequestIdentity(caller, readSessionScope(Object.fromEntries(request.headers))),
          ),
        ),
      );
    const post = async (path: string, body: unknown, caller?: Caller) =>
      request(
        new Request(`http://fixture${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        caller,
      );
    const native = new Map<number | string, number>([
      [4, 200],
      [999, 777],
    ]);
    let stored: DuctSnapshot["store"];
    let storeRevision = 0;
    /** Set to make the next ducts.apply.plan Read refuse every write, as a shared type it cannot scope does. */
    const planRefusal = { reason: null as string | null };
    const dispatched: { key: string; input: Record<string, unknown>; requestId: string }[] = [];
    const readPause = { key: "", wait: Effect.void };
    await settle(
      Effect.forkIn(
        Effect.gen(function* () {
          while (true) {
            const frame = yield* Queue.take(connection.outgoing);
            if (frame.kind !== "Request") continue;
            const req = frame.request!;
            const input = JSON.parse(req.payloadJson);
            dispatched.push({ key: req.operationKey, input, requestId: req.requestId });
            if (req.operationKey === readPause.key) yield* readPause.wait;
            let value: unknown = options.native?.(req.operationKey, input);
            if (value !== undefined) {
            } else if (req.operationKey.startsWith("ducts.snapshot.")) {
              const captured = snapshotFor(req.operationKey, input);
              value = {
                ...captured,
                ...(stored && { store: stored }),
                slots: { ...captured.slots, ...input.slots },
                nodes: captured.nodes.map((node) => ({
                  ...node,
                  facts:
                    node.kind === "terminal" && native.has(node.id)
                      ? [
                          ...node.facts.filter((fact) => fact.key !== "flow"),
                          {
                            key: "flow",
                            value: native.get(node.id)!,
                            text: null,
                            unit: "cfm",
                            provenance: "revit-reported",
                          },
                        ]
                      : node.facts,
                  flowParameter:
                    (node.kind === "terminal"
                      ? input.slots?.terminalFlow
                      : node.kind === "equipment"
                        ? input.slots?.fanFlow
                        : null) ?? node.flowParameter,
                })),
              };
            } else if (req.operationKey === "ducts.tables")
              value = { folder: "fixture", tables: {}, missing: [], unsupported: {} };
            else if (
              req.operationKey === "ducts.apply" ||
              req.operationKey === "ducts.apply.plan"
            ) {
              const preview = req.operationKey === "ducts.apply.plan";
              const writes: {
                id: number | null;
                kind: string;
                outcome: string;
                before: string;
                after: string;
                reason: string | null;
              }[] = (
                [
                  ["terminalFlows", "terminal-flow", "cfm", "cfm"],
                  ["equipmentFlows", "equipment-flow", "cfm", "cfm"],
                  ["terminals", "terminal", "inWg", "in-wg"],
                  ["components", "component", "inWg", "in-wg"],
                  ["equipment", "equipment", "externalStaticInWg", "in-wg"],
                  ["fittings", "fitting", "coefficient", "C"],
                ] as const
              ).flatMap(([field, kind, measure, unit]) =>
                (input[field] ?? []).map((row: Record<string, number>) => {
                  const id = row.id!;
                  const modelKey = field === "terminalFlows" ? id : `${field}:${id}`;
                  const before = native.get(modelKey) ?? 0;
                  const after = row[measure] ?? before;
                  if (!preview) native.set(modelKey, after);
                  return {
                    id,
                    kind,
                    outcome: !preview ? "written" : planRefusal.reason ? "refused" : "planned",
                    before: `${before} ${unit}`,
                    after: `${after} ${unit}`,
                    reason: preview ? planRefusal.reason : null,
                  };
                }),
              );
              if (input.store) {
                writes.push({
                  id: null,
                  kind: "store",
                  outcome: !preview ? "written" : planRefusal.reason ? "refused" : "planned",
                  before: stored ? "revision " + storeRevision : "absent",
                  after: "updated",
                  reason: preview ? planRefusal.reason : null,
                });
                if (!preview) {
                  stored = structuredClone(input.store);
                  storeRevision++;
                }
              }
              value = {
                previewOnly: preview,
                writes,
                counts: {
                  planned: preview ? writes.length : 0,
                  written: preview ? 0 : writes.length,
                  refused: 0,
                  unchanged: 0,
                },
                systemsAfter: [],
                storeRevision,
              };
            } else value = { error: `Fixture has no native operation ${req.operationKey}` };
            yield* Queue.offer(
              connection.incoming,
              JSON.stringify({
                kind: "Response",
                response: {
                  requestId: req.requestId,
                  openDocumentId: req.openDocumentId,
                  ok: true,
                  statusCode: 200,
                  payloadJson: JSON.stringify(value),
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
            if (req.operationKey === "ducts.apply")
              yield* Queue.offer(
                connection.incoming,
                JSON.stringify({
                  kind: "Event",
                  event: {
                    eventName: "document-changed",
                    payloadJson: JSON.stringify({ changedOpenIds: [target.ref.openId] }),
                  },
                }),
              );
          }
        }),
        scope,
      ),
    );
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
      () => Context.get(context, CaptureStore),
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
      const ref = "kind" in raw ? (raw.kind === "document" ? raw.ref : null) : raw;
      if (!ref) throw Error("Fixture requires a document target");
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
    const files = options.deps?.files ?? testDuctFiles();
    const api = createPeRoutes({
      journal,
      workspace: saved,
      registrations: [],
      store: fileRouteDocumentStore(stateFixture(join(dir, "work"))),
      heads: { observe: () => () => {} },
      navigation: {
        threads: async () => [],
        documents: async () => [{ ...target.ref, address }],
      },
      readGraph: async (raw) => {
        const port = calcPort(
          {
            firm: (owner) => settle(testDuctFiles().firm(owner)),
            catalogs: (ref) => {
              const pointer =
                ref &&
                options.state?.openDocuments?.find((doc) => doc.openId === ref.openId)?.projectHome;
              return settle(files.catalogsFor(pointer));
            },
            call: readDucts,
            workKey: async (ref) => bindWork("duct-systems", address, undefined, ref),
          },
          saved,
        );
        const graph = graphRoute("reads.value", raw);
        return graph.publish(
          publications,
          graph.publication!.subscription,
          graph.publication!.generation,
          port,
        );
      },
      observeHostResource,
    });
    return {
      api,
      dir,
      target,
      key,
      saved,
      journal,
      runs,
      native,
      dispatched,
      rootReads,
      nativeCallers,
      sdkInput,
      readPause,
      planRefusal,
      readDucts,
      observeHostResource,
      post,
      request,
      advance: (milliseconds: number) =>
        settle(TestClock.adjust(milliseconds).pipe(Effect.provide(clock))),
      async close() {
        runs.closeAll();
        await Promise.all(
          (await journal.list())
            .filter((row) => row.state === "running")
            .map((row) => journal.cancel(row.id)),
        );
        await journal.close();
        await web.dispose();
        await settle(Scope.close(scope, Exit.void));
        bindControl({ runs: undefined });
        await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await settle(Scope.close(scope, Exit.void));
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
