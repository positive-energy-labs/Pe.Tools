import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeCrypto, NodeServices, NodeHttpClient } from "@effect/platform-node";
import { Context, Effect, Exit, Layer, Queue, Scope } from "effect";
import { HttpRouter } from "effect/http";
import { TestClock } from "effect/testing";
import { bindWork, DUCTS_BODY_VERSION_HEADER, type Caller } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { RouteWorkspace } from "@pe/runtime";
import type { ResourceObserver } from "../../../packages/runtime/src/resource-stream.ts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { withInvocationContext } from "@pe/runtime/context";
import { settle } from "./effect-test.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { RevitBridge, RevitBridgeLive, BridgeError } from "../src/bridge.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { admittedBuiltinsLayer } from "../src/admitted-builtins.ts";
import { RunConsents, runConsentsPromise, type ConsentEvent } from "../src/run-consent.ts";
import { bindControl } from "../src/control.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import type { DuctsSheetSources } from "../src/ducts-sheet.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { CaptureStore } from "../src/takeoff-captures.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { readSessionScope, SdkSession, SdkDriver } from "../src/sdk-session.ts";
import { snapshot } from "../../web/src/ducts/test-fixture.ts";

/** Only the native socket and SDK observation are substituted. Work, seals and consent are real. */
export async function nativeFixture(
  clockMode: "real" | "test" = "real",
  snapshotFor: (key: string, input: Record<string, any>) => DuctSnapshot = () => snapshot,
) {
  const scope = Scope.makeUnsafe();
  const home = process.env.LOCALAPPDATA ?? tmpdir();
  await mkdir(home, { recursive: true });
  const dir = await mkdtemp(join(home, "fans-native-"));
  try {
    const saved = new RouteWorkspace({
      registrations: [],
      store: fileRouteDocumentStore(join(dir, "work")),
    });
    const context = await settle(
      Layer.buildWithScope(
        Layer.mergeAll(
          admittedBuiltinsLayer(saved),
          RunConsents.layer.pipe(Layer.provide(NodeCrypto.layer)),
          RevitBridgeLive,
          CaptureStore.layer(join(dir, "captures")),
        ),
        scope,
      ),
    );
    const clock =
      clockMode === "test"
        ? await settle(Layer.buildWithScope(TestClock.layer(), scope))
        : Context.empty();
    const consent = Context.get(context, RunConsents);
    const runs = runConsentsPromise({
      ...consent,
      authorize: (...args: Parameters<typeof consent.authorize>) =>
        consent.authorize(...args).pipe(Effect.provide(clock)),
    });
    const events: ConsentEvent[] = [];
    runs.attach({
      emit: (_run, event) => events.push(event),
      persist() {},
      autoApprove: () => true,
    });
    bindControl({ runs });
    const bridge = Context.get(context, RevitBridge);
    const connection = await settle(
      connectTestBridge().pipe(
        Effect.provideService(RevitBridge, bridge),
        Effect.provideService(Scope.Scope, scope),
      ),
    );
    const target = { kind: "document" as const, ref: connection.target };
    const key = bindWork("ducts", null, undefined, target.ref);
    const journal = new ActionJournal(join(dir, "actions.jsonl"));
    const web = HttpRouter.toWebHandler(
      makeCallRoute(
        journal,
        Context.get(context, CaptureStore),
        { sdk: sdkSessions, workspace: saved },
        {
          sdkDriver: (args) => Effect.promise(() => sdkSessions(args)),
        },
      ).pipe(
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
      withInvocationContext({ caller }, () =>
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
    const dispatched: { key: string; input: Record<string, unknown> }[] = [];
    await settle(
      Effect.forkIn(
        Effect.gen(function* () {
          while (true) {
            const frame = yield* Queue.take(connection.outgoing);
            if (frame.kind !== "Request") continue;
            const req = frame.request!;
            const input = JSON.parse(req.payloadJson);
            dispatched.push({ key: req.operationKey, input });
            let value: unknown;
            if (req.operationKey.startsWith("ducts.snapshot.")) {
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
              value = { tables: {}, missing: [], unsupported: [] };
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
                reason: null;
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
                    outcome: preview ? "planned" : "written",
                    before: `${before} ${unit}`,
                    after: `${after} ${unit}`,
                    reason: null,
                  };
                }),
              );
              if (input.store) {
                writes.push({
                  id: null,
                  kind: "store",
                  outcome: preview ? "planned" : "written",
                  before: stored ? "revision " + storeRevision : "absent",
                  after: "updated",
                  reason: null,
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
    const readDucts: DuctsSheetSources["call"] = (op, input, ref, version) =>
      request(
        new Request("http://fixture/call", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [HOST_RPC_BRIDGE_SESSION_HEADER]: ref.session,
            [HOST_RPC_DOCUMENT_HEADER]: ref.openId,
            ...(version && { [DUCTS_BODY_VERSION_HEADER]: version }),
          },
          body: JSON.stringify({ key: op, request: input }),
        }),
      );
    const api = createPeRoutes({
      workspace: saved,
      registrations: [],
      store: fileRouteDocumentStore(join(dir, "work")),
      heads: { observe: () => () => {} },
      navigation: {
        threads: async () => [],
        documents: async () => [{ ...target.ref, address: null }],
      },
      ductsSheets: { call: readDucts },
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
      events,
      native,
      dispatched,
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
            .filter((row) => ["running", "waiting", "queued"].includes(row.state))
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
