import { ActionJournal } from "../src/action-journal.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { RevitBridgeLive } from "../src/bridge.ts";
import { nativeReadRoot } from "../src/app.ts";
import { PictureCaptureStore } from "../src/captures-route.ts";
import { NodeServices, NodeHttpClient } from "@effect/platform-node";
import { CaptureStore } from "../src/takeoff-captures.ts";
import type { NativeReadInput } from "@pe/host-internal/native-read";
import type { BridgeSessionsListData } from "@pe/host-contracts/operation-types";
import { unavailableFieldOptions } from "./effect-test.ts";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { expect } from "vite-plus/test";
import { canonicalJson, HostNativeRead } from "@pe/host-internal/native-read";
import { address, bindWork } from "@pe/agent-contracts";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { withInvocationContext } from "@pe/runtime/context";
import type { RouteWorkspace } from "@pe/runtime";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import rosterCapture from "../../../packages/host-contracts/src/fixtures/k2-roster.json" with { type: "json" };
import fanCapture from "../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json" with { type: "json" };
import { makeReadOwner } from "../src/builtin-inputs.ts";
import { createPeRoutes, peCoreRoutes } from "../src/pe-routes.ts";
import { historyRoutes } from "../src/reads/history-routes.ts";
import { fansReadResponse } from "../../../packages/agent-contracts/src/fans-read.ts";
import { HostInputContext } from "../src/input-context.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import { DuctFiles } from "../src/ducts-files.ts";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { HostSessionInventory } from "../src/session-inventory.ts";
import { FIRM_SEED } from "../src/ducts-inputs.ts";
import { DuctsReadings } from "../src/ducts-readings.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { nativeCatalogIdentity, openRecordingWriter } from "../src/native-recording.ts";
import { settle } from "./effect-test.ts";
export const ref = { session: "spike", openId: "model" };
export const target = {
  processIncarnation: { pid: 42, startedAt: 1 },
  openDocumentLifetime: { openId: ref.openId },
};
export const who = { kind: "human" as const, via: "local" as const };
export const scope = { bridgeSessionId: ref.session, openDocumentId: ref.openId };
export const path = address("C:/Models/Chadds.rvt");
export const key = (route: string) => bindWork(route, path, undefined, ref);
export const gate = () => ({
  entered: Promise.withResolvers<void>(),
  release: Promise.withResolvers<void>(),
});
export const identity = { build: "host-read-spike", catalog: nativeCatalogIdentity() };
export const bounds = { maxBytes: 256 * 1024 * 1024, maxTakings: 2000 };
export const roster = nativeResponseSchema("ducts.snapshot.walk").parse(rosterCapture);
export const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(fanCapture);
export async function fixture(
  capture = false,
  recorded: {
    actions?: boolean;
    snapshot?: typeof snapshot;
    roster?: typeof roster;
    document?: HostSessionInventory["Service"]["document"];
    read?: (input: NativeReadInput) => unknown;
    inventory?: BridgeSessionsListData;
  } = {},
) {
  const native = recorded.read && recorded.inventory ? { read: recorded.read, inventory: recorded.inventory } : undefined;
  const dir = await mkdtemp(join(tmpdir(), "host-read-spike-"));
  await mkdir(join(dir, "catalogs"));
  await writeFile(join(dir, "firm.json"), JSON.stringify(FIRM_SEED));
  let workspace!: RouteWorkspace;
  let mark = 10,
    generation = 0,
    nativeCalls = 0;
  const markListeners = new Set<() => void>();
  const holds = new Map<string, ReturnType<typeof gate>>();
  let nativeHold: ReturnType<typeof gate> | undefined;
  const owner = new DuctsReadings();
  const marks = hostMarks({
    observedSince: 1,
    changedAt: () => mark,
    generation: () => generation,
    subscribe: (listener) => {
      markListeners.add(listener);
      return () => {
        markListeners.delete(listener);
      };
    },
  });
  const inputs = await settle(
    HostInputContext.pipe(
      Effect.provide(
        HostInputContext.layer({
          kind: "live",
          captureStore: capture
            ? await settle(openRecordingWriter(join(dir, "recording"), identity, bounds))
            : undefined,
        }),
      ),
    ),
  );
  const journal = new ActionJournal(join(dir, "actions.jsonl"), Date.now);
  let reads!: Effect.Success<ReturnType<typeof makeReadOwner>>;
  const fixtureRoutes = (options: Parameters<typeof makeReadOwner>[1]) => Layer.unwrap(Effect.gen(function* () {
    reads = yield* makeReadOwner(inputs, options);
    const captures = yield* CaptureStore;
    const routes = createPeRoutes({ inputs, workspace: reads.work.workspace, registrations: reads.work.registrations,
      observeHostResource: hostResourceObserver(undefined, () => journal, () => captures) });
    return Layer.mergeAll(peCoreRoutes(routes, reads.invocation, inputs), historyRoutes(reads.history),
      recorded.actions ? makeCallRoute(journal, undefined, {workspace: reads.work.workspace, workReads: reads.work.reads}).pipe(
        nativeReadRoot(), Layer.provide(RevitBridgeLive),
        Layer.provideMerge(PictureCaptureStore.layer(join(dir, "pictures"))),
        HttpRouter.provideRequest(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici, RevitBridgeLive)),
      ) : Layer.empty).pipe(
      HttpRouter.provideRequest(Layer.succeedContext(Context.add(reads.services, HostInputContext, inputs))),
      Layer.provide(Layer.succeedContext(Context.add(reads.services, HostInputContext, inputs))),
    );
  }));
  const web = HttpRouter.toWebHandler(
    fixtureRoutes({
      store: fileRouteDocumentStore(join(dir, "work")),
      initialize: async (current) => {
        workspace = current;
      },
      live: {
        owner,
        files: DuctFiles.layer({ firm: join(dir, "firm.json"), catalogs: join(dir, "catalogs") }),
        marks: Layer.succeed(HostDocumentMarks, {
          ...marks,
          snapshot: (doc) =>
            Effect.gen(function* () {
              const request = yield* Effect.serviceOption(RequestIdentity);
              const requestId = request._tag === "Some" ? request.value.requestId : "";
              const hold = holds.get(requestId);
              if (hold) {
                holds.delete(requestId);
                hold.entered.resolve();
                yield* Effect.promise(() => hold.release.promise);
              }
              return yield* marks.snapshot(doc);
            }),
        }),
        inventory: Layer.succeed(HostSessionInventory, {
          document: recorded.document ?? (() => Effect.succeed({ ...ref, address: path })),
          session: () => Effect.succeed({ sessionId: ref.session }),
          attachment: () => Effect.succeed({ sessionId: ref.session }),
          list: () => native ? Effect.succeed(native.inventory) : Effect.die("No inventory list requested"),
          subscribe: () => () => {},
        }),
        native: Layer.succeed(HostNativeRead, {
          resolve: (input) =>
            Effect.succeed({
              ...target,
              openDocumentLifetime:
                input.key === "ducts.tables"
                  ? { kind: "session-only" as const }
                  : target.openDocumentLifetime,
              operationKey: input.key,
              normalizedInput: canonicalJson(JSON.parse(JSON.stringify(input.input))),
              freshnessGeneration: "g1",
              representation: "overview",
            }),
          read: (input) =>
            Effect.gen(function* () {
              nativeCalls++;
              const hold = nativeHold;
              if (hold && input.key === "ducts.snapshot.walk") {
                nativeHold = undefined;
                hold.entered.resolve();
                yield* Effect.promise(() => hold.release.promise);
              }
              return {
                value: Schema.decodeUnknownSync(Schema.Json)(
                  native ? yield* Effect.promise(async () => native.read(input)) : input.key === "revit.catalog.field-options"
                    ? unavailableFieldOptions
                    : input.key === "ducts.tables"
                      ? {
                          folder: "captured",
                          tables: {},
                          missing: (input.input as { ids: string[] }).ids,
                          unsupported: {},
                        }
                      : input.key === "ducts.snapshot.roster"
                        ? (recorded.roster ?? roster)
                        : (recorded.snapshot ?? snapshot),
                ),
                nativeRequestId: `native-${nativeCalls}`,
                actualTarget:
                  input.key === "ducts.tables"
                    ? { ...target, openDocumentLifetime: { kind: "session-only" as const } }
                    : target,
                freshness: { freshnessGeneration: "g1" },
                cost: {},
                outcome: "committed" as const,
              };
            }),
        }),
      },
    }).pipe(Layer.provide(CaptureStore.layer(join(dir, "captures")))),
    { disableLogger: true },
  );
  const send = async (
    generation: number,
    fan: string[],
    hold?: ReturnType<typeof gate>,
    subscription = "sheet",
    release = false,
    at?: string,
  ) => {
    const admitted = admittedRequestIdentity(who, scope);
    if (hold) holds.set(admitted.requestId, hold);
    const response = await withInvocationContext({ caller: who }, () =>
      web.handler(
        new Request("http://host/pe/fans/sheet", {
          method: "POST",
          headers: at
            ? {
                "x-pe-history-point": at,
                "x-pe-history-page": encodeURIComponent(
                  JSON.stringify({
                    instance: "fans.sheet",
                    route: "fans",
                    page: {},
                    href: "/fans",
                  }),
                ),
              }
            : {},
          body: JSON.stringify({
            subscription,
            generation,
            release,
            args: { target: ref, fan, sheetPath: "" },
          }),
        }),
        Context.make(RequestIdentity, admitted),
      ),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return fansReadResponse.parse(await response.json());
  };
  return {
    dir,
    get reads() { return reads; },
    inputs,
    journal,
    request: (request: Request) => withInvocationContext({ caller: who }, () =>
      web.handler(request, Context.make(RequestIdentity, admittedRequestIdentity(who, scope)))),
    publicationEvent: async (generation: number) => {
      const url = new URL(peRouteUrl("reads.events", {}), "http://host");
      url.searchParams.set("subscription", "sheet");
      url.searchParams.set("generation", String(generation));
      const response = await withInvocationContext({ caller: who }, () =>
        web.handler(new Request(url), Context.make(RequestIdentity, admittedRequestIdentity(who, scope))),
      );
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      try {
        let text = "";
        while (!text.includes("data: ")) {
          const chunk = await reader.read();
          if (chunk.done) throw Error("Publication stream closed without a state");
          text += new TextDecoder().decode(chunk.value);
        }
        return JSON.parse(text.split("data: ")[1]!.split("\n")[0]!);
      } finally {
        await reader.cancel();
      }
    },
    probe: (body: unknown) =>
      withInvocationContext({ caller: who }, () =>
        web.handler(
          new Request(new URL(peRouteUrl("reads.value", {}), "http://host"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          Context.make(RequestIdentity, admittedRequestIdentity(who, scope)),
        ),
      ),
    send,
    history: async (query = "", body?: unknown) => {
      const response = await withInvocationContext({ caller: who }, () =>
        web.handler(
          new Request(
            `http://host/pe/history${query}`,
            body === undefined
              ? {}
              : {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(body),
                },
          ),
          Context.make(RequestIdentity, admittedRequestIdentity(who, scope)),
        ),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json();
    },
    get nativeCalls() {
      return nativeCalls;
    },
    get workspace() {
      return workspace;
    },
    changed(sameMillisecond = false) {
      if (!sameMillisecond) mark++;
      generation++;
      for (const notify of markListeners) notify();
    },
    holdNative() {
      owner.refresh(ref);
      nativeHold = gate();
      return nativeHold;
    },
    async close() {
      nativeHold?.release.resolve();
      for (const hold of holds.values()) hold.release.resolve();
      await web.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
