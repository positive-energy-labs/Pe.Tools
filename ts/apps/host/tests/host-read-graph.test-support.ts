import { hostState } from "../src/host-ownership.ts";
import { DUCT_UNIT_KINDS, FAN_BLOCKER_KINDS } from "@pe/host-contracts/generated";
import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { actAs } from "./callers.ts";
import { RevitBridgeLive } from "../src/bridge.ts";
import { nativeReadRoot } from "../src/app.ts";
import { PictureCaptureStore } from "../src/captures-route.ts";
import { NodeServices, NodeHttpClient } from "@effect/platform-node";
import { CaptureStore } from "../src/observation-store.ts";
import type { NativeReadInput } from "@pe/host-internal/native-read";
import type { BridgeSessionsListData } from "@pe/host-contracts/operation-types";
import { unavailableFieldOptions, journalAt, callRouteOver } from "./effect-test.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { expect } from "vite-plus/test";
import { z } from "zod";
import { canonicalJson, HostNativeRead } from "@pe/host-internal/native-read";
import { address, bindWork } from "@pe/agent-contracts";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import type { RouteWorkspace } from "@pe/runtime";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import rosterCapture from "../../../packages/host-contracts/src/fixtures/k2-roster.json" with { type: "json" };
import fanCapture from "../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json" with { type: "json" };
import { makeReadOwner } from "../src/builtin-inputs.ts";
import { createPeRoutes, peCoreRoutes } from "../src/pe-routes.ts";
import { historyRoutes } from "../src/reads/history-routes.ts";
import { fansReadResponse } from "@pe/fans-contract/fans-read";
import { HostInputContext } from "../src/input-context.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import { DuctFiles } from "@pe/ducts-host/ducts-files";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { HostSessionInventory } from "../src/session-inventory.ts";
import { FIRM_SEED } from "@pe/ducts-host/ducts-inputs";
import { DuctsReadings } from "@pe/ducts-host/ducts-readings";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { RequestIdentity, admittedRequestIdentity } from "@pe/host-internal/request-identity";
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
// The captures predate the native vocabulary; it is the generated one, added whole.
const vocabulary = { unitKinds: [...DUCT_UNIT_KINDS], blockerKinds: [...FAN_BLOCKER_KINDS] };
export const roster = nativeResponseSchema("ducts.snapshot.walk").parse({
  ...rosterCapture,
  vocabulary,
});
export const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse({
  ...fanCapture,
  vocabulary,
});
export async function fixture(
  capture = false,
  recorded: {
    resourceObserver?: import("@pe/runtime").ResourceObserver;
    actions?: boolean;
    snapshot?: typeof snapshot;
    roster?: typeof roster;
    document?: HostSessionInventory["Service"]["document"];
    list?: HostSessionInventory["Service"]["list"];
    read?: (input: NativeReadInput) => unknown;
    inventory?: BridgeSessionsListData;
    freshness?: () => string;
  } = {},
) {
  const native =
    recorded.read && recorded.inventory
      ? { read: recorded.read, inventory: recorded.inventory }
      : undefined;
  const dir = await mkdtemp(join(tmpdir(), "host-read-spike-"));
  await mkdir(join(dir, "Catalogs"));
  await mkdir(join(dir, "Settings"), { recursive: true });
  await writeFile(join(dir, "Settings", "ducts.json"), JSON.stringify(FIRM_SEED));
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
            ? await settle(
                openRecordingWriter(stateFixture(join(dir, "recording")), identity, bounds),
              )
            : undefined,
        }),
      ),
    ),
  );
  const journal = journalAt(join(dir, "actions.jsonl"), Date.now);
  let reads!: Effect.Success<ReturnType<typeof makeReadOwner>>;
  const fixtureRoutes = (options: Parameters<typeof makeReadOwner>[1]) =>
    Layer.unwrap(
      Effect.gen(function* () {
        reads = yield* makeReadOwner(inputs, options);
        const captures = yield* CaptureStore;
        const routes = createPeRoutes({
          inputs,
          workspace: reads.work.workspace,
          registrations: reads.work.registrations,
          observeHostResource:
            recorded.resourceObserver ??
            hostResourceObserver(
              undefined,
              () => journal,
              () => captures,
            ),
        });
        return Layer.mergeAll(
          peCoreRoutes(routes, reads.invocation, inputs),
          historyRoutes(reads.history),
          recorded.actions
            ? callRouteOver(journal, undefined, {
                workspace: reads.work.workspace,
                workReads: reads.work.reads,
              }).pipe(
                nativeReadRoot(),
                Layer.provide(RevitBridgeLive),
                Layer.provideMerge(PictureCaptureStore.layer(stateFixture(join(dir, "pictures")))),
                HttpRouter.provideRequest(
                  Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici, RevitBridgeLive),
                ),
              )
            : Layer.empty,
        ).pipe(
          HttpRouter.provideRequest(
            Layer.succeedContext(Context.add(reads.services, HostInputContext, inputs)),
          ),
          Layer.provide(
            Layer.succeedContext(Context.add(reads.services, HostInputContext, inputs)),
          ),
        );
      }),
    );
  const web = HttpRouter.toWebHandler(
    fixtureRoutes({
      store: fileRouteDocumentStore(stateFixture(join(dir, "work"))),
      initialize: async (current) => {
        workspace = current;
      },
      live: {
        owner,
        files: DuctFiles.layer(hostState().home, {
          firm: join(dir, "Settings"),
          catalogs: [{ tier: "firm", root: dir }],
        }),
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
          list:
            recorded.list ??
            (() =>
              native
                ? Effect.succeed(native.inventory)
                : Effect.die("No inventory list requested")),
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
                  native
                    ? yield* Effect.promise(async () => native.read(input))
                    : input.key === "revit.catalog.field-options"
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
                freshness: { freshnessGeneration: recorded.freshness?.() ?? "g1" },
                cost: {},
                outcome: "committed" as const,
              };
            }),
        }),
      },
    }).pipe(Layer.provide(CaptureStore.layer(stateFixture(join(dir, "captures"))))),
    { disableLogger: true },
  );
  // Initialize the lazy owner before tests install input-open barriers. These fixtures hold
  // publications directly; publication-connections.test.ts exercises real stream cleanup.
  const ready = await actAs(who, () =>
    web.handler(
      new Request("http://host/pe/resources?connection=fixture"),
      Context.make(RequestIdentity, admittedRequestIdentity(who, scope)),
    ),
  );
  await ready.body!.cancel();
  const holders = new Map<string, () => void>();
  const holdPublication = (subscription: string) => {
    if (holders.has(subscription)) return;
    holders.set(
      subscription,
      reads.publications.observe(canonicalJson([who, subscription]), () => {}),
    );
  };
  const send = async (
    generation: number,
    fan: string[],
    hold?: ReturnType<typeof gate>,
    subscription = "sheet",
    release = false,
    at?: string,
  ) => {
    const admitted = admittedRequestIdentity(who, scope);
    holdPublication(subscription);
    if (hold) holds.set(admitted.requestId, hold);
    const response = await actAs(who, () =>
      web.handler(
        new Request("http://host/pe/reads/value", {
          method: "POST",
          headers: at
            ? {
                "x-pe-history-point": at,
                "x-pe-history-page": encodeURIComponent(
                  JSON.stringify({
                    instance: "fans.calc",
                    route: "fans",
                    page: {},
                    href: "/fans",
                  }),
                ),
              }
            : {},
          body: JSON.stringify({
            read: "fans.calc",
            subscription,
            generation,
            release,
            args: { target: ref, fan, calcPath: "" },
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
    holdPublication,
    get reads() {
      return reads;
    },
    inputs,
    journal,
    request: (request: Request) =>
      actAs(who, () =>
        web.handler(request, Context.make(RequestIdentity, admittedRequestIdentity(who, scope))),
      ),
    publicationEvent: async (generation: number) => {
      const url = new URL(peRouteUrl("resources.stream", {}), "http://host");
      url.searchParams.set(
        "keys",
        JSON.stringify([{ kind: "publication", subscription: "sheet", generation }]),
      );
      const response = await actAs(who, () =>
        web.handler(
          new Request(url),
          Context.make(RequestIdentity, admittedRequestIdentity(who, scope)),
        ),
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
        return JSON.parse(text.split("data: ")[1]!.split("\n")[0]!).value;
      } finally {
        await reader.cancel();
      }
    },
    probe: async (body: unknown) => {
      const parsed = z.object({ subscription: z.string() }).safeParse(body);
      if (parsed.success) holdPublication(parsed.data.subscription);
      return actAs(who, () =>
        web.handler(
          new Request(new URL(peRouteUrl("reads.value", {}), "http://host"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          Context.make(RequestIdentity, admittedRequestIdentity(who, scope)),
        ),
      );
    },
    send,
    history: async (query = "", body?: unknown) => {
      const response = await actAs(who, () =>
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
      for (const release of holders.values()) release();
      nativeHold?.release.resolve();
      for (const hold of holds.values()) hold.release.resolve();
      await web.dispose();
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
