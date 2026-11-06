import { ResourceConnectionOwner } from "./request-services.ts";
import { readInvalidations } from "./reads/invalidations.ts";
import { readEvents } from "./reads/events.ts";
import { Publications, evaluate } from "./reads/evaluator.ts";
import { graphRoute, graphRouteIds } from "./reads/routes.ts";
import { ductsInputPort, type DuctsReadSources } from "./reads/ducts-inputs.ts";
import { HostInputContext } from "./input-context.ts";
import type { TakingObserver } from "./native-recording.ts";
import { recordedWorkSource, capturedWorkReads, workReadContext, type WorkInputRunner } from "./work-inputs.ts";
import { CurrentInputConsumption, HostInputReadSets, type InputConsumption, type ReadSetId, type ConsumerRecipe } from "./input-occurrence.ts";

import { matchPeRoute, peRoutes } from "@pe/agent-contracts/pe-api";
import { HostSessionInventory } from "./session-inventory.ts";
import { createDuctsBodyBasis } from "./ducts-body-basis.ts";
import { DuctsReadings, ductsReadings } from "./ducts-readings.ts";
import { createPeRoutes, peCoreRoutes, type PeInvocationFactory } from "./pe-routes.ts";
import { runPods } from "./family-actions.ts";
import { bindWork, readingKey, type DuctsReadingEnvelope } from "@pe/agent-contracts";
import { observeResources, resourceSnapshot, WorkCarriage, OwnerReads, type ResourceObserver, type WorkReadContext } from "@pe/runtime";
import { markReadings } from "./resource-adapters.ts";
import { retainedDuctsRead } from "./call-route.ts";
import { HttpServerResponse } from "effect/http";
import type { RequestIdentity as RequestIdentityKey } from "@pe/host-internal/request-contracts";
import { hostNativeReadFor } from "./native-recording.ts";
import { httpProblems, isDoorFailure } from "./http-problems.ts";
import { InvalidRead } from "./native-reads.ts";
import { nativeCallRouteFor, nativeReadResolveRoute } from "./call-route.ts";
import { Spawner } from "./harness/spawner.ts";
import { currentMachine } from "./machine.ts";
import { SdkSession, SdkDriverLive } from "./sdk-session.ts";
import { ReadFreshness, RequestIdentity } from "./request-services.ts";
import { NativeReads } from "./native-reads.ts";
import { HostNativeRead, canonicalJson, type NativeReadInput } from "@pe/host-internal/native-read";
import { HostNativeReadLive } from "./native-read.ts";
import { requestIdentityLayer } from "./request-identity.ts";
import { createDevices, type Devices } from "./remote-device.ts";
import { deviceRoutes } from "./device-routes.ts";
import { bindControl, Refused } from "./control.ts";
import { readRemoteIngress, remoteListener } from "./remote-ingress.ts";
import {
  createShare,
  shareIntentFile,
  shareRoute,
  tailscaleCommand,
  type ShareOwner,
} from "./share.ts";
import { mcpRoute } from "./mcp-route.ts";
import { Context, Deferred, Effect, Layer, Option, Result, Schema } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/http";
import { NodeHttpClient, NodeHttpServer, NodeServices } from "@effect/platform-node";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { BRIDGE_PATH, hostProcessIdentity } from "@pe/host-contracts/contracts";
import { RouteWorkspace, type PeaRuntimeCapabilities } from "@pe/runtime";
import { createRouteRegistrations } from "@pe/mcps";
import { admittedBuiltinsLayer, constructorWorkRegistrations } from "./admitted-builtins.ts";
import { catalogWorkSpecs } from "@pe/agent-contracts";
import { hostLoadedFamilies } from "../../../packages/mcps/src/pea/families-admission.ts";
import { fileRouteDocumentStore } from "./route-document-store.ts";
import { productRouteWorkPath } from "./product-paths.ts";
import { HostReceipts } from "./gateway-owner.ts";
import { ReceiptExport, type ReceiptExporter } from "./receipt-export.ts";
import { CaptureStore } from "./takeoff-captures.ts";
import { RevitBridge, RevitBridgeLive } from "./bridge.ts";
import { RunConsents } from "./run-consent.ts";
import { getHostStatus } from "./local-ops.ts";
import { isSettingsSchemaUrl } from "./settings.ts";
import { isNavigation, opsCatalogRoute, type SpaFallback } from "./ops-catalog.ts";
import { demoRoutes } from "./demo-owner.ts";
import { makeCallRoute } from "./call-route.ts";
import { FamiliesReader } from "./families-reader.ts";
import { instancesReadingsRoute } from "./session-route.ts";
import {
  adminShutdownRoute,
  adminWindowRoute,
  HostLifecycle,
  resolveHostVersion,
  ServiceFileLive,
} from "./host-lifecycle.ts";
import { hostOwnership } from "./host-ownership.ts";
import { staticSpaLayer } from "./static-spa.ts";
import { peRoutesLayer, peApiErrorsLayer, type HostWork } from "./pe-routes.ts";
import { threadPointerPort } from "./thread-pointers.ts";
import { capturesRoute } from "./captures-route.ts";
import { ductCatalogsRoute, DuctFiles } from "./ducts-files.ts";
import { HostDocumentMarks } from "./document-marks.ts";
import { PictureCaptureStore } from "./captures-route.ts";
import { pagesRoute } from "./pages-route.ts";
import { makeInstalledUpdateReader, updateRoutes } from "./update-route.ts";
import { UpdateReader, type UpdateFact } from "./update-reader.ts";

export { resolveWebRoot } from "./static-spa.ts";

const bridgeWsRoute = HttpRouter.add("GET", BRIDGE_PATH, (req) =>
  Effect.flatMap(RevitBridge, (bridge) => bridge.handleConnection(req)),
);

// Live settings authoring schema, straight from the connected session. This is
// the $schema URL settings documents carry — IDE JSON LSPs fetch it on open.
// Never persisted: value-domain samples inside are derived from the open document.
export const settingsSchemaRoute = HttpRouter.add("GET", "/schemas/settings/*", (req) =>
  Effect.gen(function* () {
    const identity = yield* RequestIdentity;
    const schemaUrl = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`).href;
    if (!isSettingsSchemaUrl(schemaUrl))
      return Response.jsonUnsafe({ error: `No schema at ${schemaUrl}` }, { status: 404 });
    const result = yield* Effect.result(
      (yield* HostNativeRead).read({ key: "settings.schema", input: { schemaUrl }, scope: identity.scope }),
    );
    if (result._tag === "Failure")
      return Response.jsonUnsafe(
        { error: String(result.failure.message ?? result.failure) },
        { status: result.failure.status },
      );
    const value = result.success.value;
    const schemaJson = value && typeof value === "object" && "schemaJson" in value ? value.schemaJson : undefined;
    if (typeof schemaJson !== "string" || !schemaJson)
      return Response.jsonUnsafe({ error: `No schema at ${schemaUrl}` }, { status: 404 });
    return Response.text(schemaJson, {
      headers: { "content-type": "application/json", "cache-control": "no-cache" },
    });
  }),
);

export const hostStatusRoute = HttpRouter.add("GET", hostProcessIdentity.healthPath, () =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const sessions = yield* bridge.list;
    return yield* Response.json(
      yield* getHostStatus(
        {
          connected: sessions.length > 0,
          runtimeMatch: sessions.every((session) => session.runtimeMatch === "verified")
            ? "verified"
            : "unknown",
        },
        undefined,
        yield* bridge.lastRegistrationRefusal,
      ),
    );
  }),
);

const noRevitHostStatusRoute = HttpRouter.add("GET", hostProcessIdentity.healthPath, () =>
  Effect.flatMap(getHostStatus({ connected: false }, { revit: false }), Response.json),
);

const emptyNotFound = Effect.succeed(Response.empty({ status: 404 }));

const noRevitBoundary = () =>
  Layer.mergeAll(
    HttpRouter.add("*", BRIDGE_PATH, emptyNotFound),
    HttpRouter.add("*", "/schemas/settings/*", emptyNotFound),
    HttpRouter.add("*", "/host/install", emptyNotFound),
  );

// Installed-version readout for the web release chip. The installed layout is fixed (no receipt,
// no pointer), so the only truth about "which release is this" is the version baked into this
// bundle at pack time.
const hostInstallRoute = HttpRouter.add("GET", "/host/install", () =>
  Effect.sync(() => {
    const installed = hostOwnership.lane === "installed";
    return Response.jsonUnsafe({
      installed,
      releaseVersion: installed ? resolveHostVersion() : null,
    });
  }),
);

function makeRevitComposition(
  spa: SpaFallback = () => emptyNotFound,
  origin?: () => string,
) {
  return {
    provider: RevitBridgeLive,
    routes: Layer.mergeAll(
      bridgeWsRoute,
      opsCatalogRoute(spa),
      settingsSchemaRoute,
      hostStatusRoute,
      hostInstallRoute,
      instancesReadingsRoute(currentMachine),
      Layer.unwrap(
        Effect.gen(function* () {
          const families = yield* FamiliesReader;
          const { work, retainedCall, nativeBody } = yield* ReadOwner;
          return makeCallRoute(
            (yield* HostReceipts).journal,
            undefined,
            { workspace: work.workspace },
            { origin, families, pointers: work.pointers, retainedRead: retainedCall, nativeBody },
          );
        }),
      ),
    ),
  };
}

/** Build once outside sibling routes, then expose that exact context to each request. */
const guardedNativeRead = () => Layer.effect(HostNativeRead, Effect.gen(function* () {
  const reads = yield* HostNativeRead;
  const inputs = yield* HostInputContext;
  return {
    read: (request: Parameters<typeof reads.read>[0]) => {
      const refusal = inputs.check({ kind: "native", key: request.key });
      return refusal ? Effect.fail(refusal) : reads.read(request);
    },
    resolve: (request: Parameters<typeof reads.resolve>[0]) => {
      const refusal = inputs.check({ kind: "native", key: request.key });
      return refusal ? Effect.fail(refusal) : reads.resolve(request);
    },
  };
}));

export const nativeReadRoot = (driver = SdkDriverLive, inputs?: HostInputContext["Service"]) => <A, E, R>(routes: Layer.Layer<A, E, R>) =>
  Layer.unwrap(Effect.gen(function* () {
    const source = inputs ?? (yield* HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "live" }))));
    if (source.lane.kind !== "live") return yield* Effect.die(Error("Live native root requires a live input graph"));
    const base = yield* Layer.build(Layer.mergeAll(
      SdkSession.layer.pipe(Layer.provide(driver)), ReadFreshness.layer, NativeReads.layer,
    ));
    const backend = HostNativeReadLive.pipe(Layer.provide(Layer.succeedContext(base)));
    const reads = yield* Layer.build(guardedNativeRead().pipe(
      Layer.provide(backend),
      Layer.provideMerge(Layer.succeed(HostInputContext, source)),
    ));
    const provided = Layer.succeedContext(Context.merge(base, reads));
    return routes.pipe(HttpRouter.provideRequest(provided), Layer.provide(provided));
  }));

/** Recording has no live service requirements; this recipe is never acquired on replay. */
const liveNativeRecipe = HostNativeReadLive.pipe(
  Layer.provide(Layer.mergeAll(SdkSession.layer.pipe(Layer.provide(SdkDriverLive)), ReadFreshness.layer, NativeReads.layer)),
  Layer.provide(RevitBridgeLive),
);

const recordingCoverage = Effect.fail(new InvalidRead({ message: "Recording does not cover this owner", status: 409, problem: "recording.coverage" }));
export const historicalRoutes = (inputs: HostInputContext["Service"], webRoot: string | null) =>
  Layer.mergeAll(readCoreRoutes(inputs), staticSpaLayer(webRoot, recordingCoverage)).pipe(Layer.provide(httpProblems));

/** One host input HTTP/Work graph; live uses the bridge-subscribed retained owner, replay builds no live port. */
export const makeReadOwner = Effect.fn("Reads.compose")(function* (inputs: HostInputContext["Service"], options: {
  readonly live?: { owner: DuctsReadings; native: Layer.Layer<HostNativeRead>; files: Layer.Layer<DuctFiles>;
    marks: Layer.Layer<HostDocumentMarks>; inventory: Layer.Layer<HostSessionInventory> };
  readonly store?: import("@pe/runtime").RouteDocumentStore;
  readonly observed?: TakingObserver;
  readonly observedReadSet?: (recipe: ConsumerRecipe, id: ReadSetId, requestId: string | undefined, caller: import("@pe/agent-contracts").Caller | undefined) => void;
  readonly initialize?: (workspace: RouteWorkspace) => Promise<void>;
  readonly registrations?: HostWork["registrations"];
  readonly pointers?: HostWork["pointers"];
} = {}) {
  const runtime = yield* Effect.context<never>();
  const lane = inputs.lane;
  if (lane.kind === "fixture") return yield* Effect.die(Error("A fixture has no host input graph"));
  const basis = createDuctsBodyBasis(lane, options.observed);
  const recorded = lane.kind === "recording";
  const live = recorded ? undefined : options.live;
  if (!recorded && (!live || !options.store)) return yield* Effect.die(Error("Live input graph needs its real live inputs and Work store"));
  const writer = lane.kind === "live" ? lane.captureStore : undefined;
  const services = yield* Layer.build(Layer.mergeAll(
    HostInputReadSets.layer(lane),
    guardedNativeRead().pipe(Layer.provide(hostNativeReadFor(lane, recorded ? liveNativeRecipe : live!.native, basis?.observed)), Layer.provide(Layer.succeed(HostInputContext, inputs))),
    recorded ? DuctFiles.recorded(lane.recordingStore) : writer ? DuctFiles.capturing(writer, options.observed).pipe(Layer.provide(live!.files)) : live!.files,
    recorded ? HostDocumentMarks.recorded(lane.recordingStore) : writer ? HostDocumentMarks.capturing(writer, options.observed).pipe(Layer.provide(live!.marks)) : live!.marks,
    recorded ? HostSessionInventory.recorded(lane.recordingStore) : writer ? HostSessionInventory.capturing(writer, options.observed).pipe(Layer.provide(live!.inventory)) : live!.inventory,
  ));
  const provided = Context.merge(runtime, services);
  const run = <A, E>(effect: Effect.Effect<A, E>) => runPods({}, Effect.provide(effect, provided));
  const registrations = options.registrations ?? createRouteRegistrations();
  const workspace = new RouteWorkspace({ registrations: constructorWorkRegistrations(registrations),
    ...(recorded ? { recorded: recordedWorkSource(lane.recordingStore) } :
      { store: options.store!, ...(writer ? { capture: capturedWorkReads(writer, run, options.observed) } : {}) }),
    authorizeMutation: (verb) => { const refusal = inputs.check({ kind: "work", verb }); if (refusal) throw refusal; },
  });
  yield* Layer.build(admittedBuiltinsLayer(workspace, undefined, registrations));
  if (!recorded && options.initialize) yield* Effect.promise(() => options.initialize!(workspace));
  const owner = recorded ? new DuctsReadings() : live!.owner;
  const files = Context.get(services, DuctFiles), marks = Context.get(services, HostDocumentMarks);
  const readSets = Context.get(services, HostInputReadSets);
  const publications = new Publications();
  const invalidations = readInvalidations(workspace, marks, recorded, publications, files.subscribe);
  yield* Effect.addFinalizer(() => Effect.sync(invalidations.close));
  const json = (value: unknown) => Schema.decodeUnknownSync(Schema.Json)(JSON.parse(JSON.stringify(value)));
  const child = (parent: InputConsumption, recipe: ConsumerRecipe) => {
    const next = parent.child(recipe);
    if (Result.isFailure(next)) throw next.failure;
    return next.success;
  };
  const sealed = (current: InputConsumption) => current.seal.pipe(Effect.tap(() => Effect.gen(function* () {
    const request = yield* Effect.serviceOption(RequestIdentity);
    if (writer && !writer.capture.truncated()) yield* Effect.try(() =>
      options.observedReadSet?.(current.recipe, current.id, Option.isSome(request) ? request.value.requestId : undefined,
        Option.isSome(request) ? request.value.caller : undefined),
    ).pipe(Effect.catch(() => {
      const at = writer.capture.begin();
      return at === null ? Effect.void : writer.capture.stop(at, "observer");
    }));
  })));
  const retained = (current: InputConsumption, input: NativeReadInput,
    readOptions: { version?: string; refresh?: string }, role: "acquire" | "validate" | "join" | "beyond" | undefined,
    document: HostSessionInventory["Service"]["document"]) => Effect.gen(function* () {
      const nested = yield* Effect.try({ try: () => child(current, { key: "ducts.retained", input: json({ key: input.key, request: input.input,
        expectedVersion: readOptions.version ?? null, role }), scope: canonicalJson(input.scope) }),
        catch: (error) => isDoorFailure(error) ? error : new InvalidRead({ message: String(error), status: 409, problem: "recording.context" }) });
      return yield* retainedDuctsRead(owner, input, readOptions, { document, basis }).pipe(
        Effect.onExit(() => sealed(nested)), Effect.ensuring(nested.close), Effect.provideService(CurrentInputConsumption, nested));
    });
  const invocation: PeInvocationFactory = async (request, web, fallback) => {
    const identity = Context.get(request, RequestIdentity);
    const connectionOwner = Option.getOrNull(Context.getOption(request, ResourceConnectionOwner));
    const admitted = Context.add(provided, RequestIdentity, identity);
    const invoke = <A, E>(effect: Effect.Effect<A, E, RequestIdentityKey | HostNativeRead>) => runPods({}, Effect.provide(effect, admitted));
    const url = new URL(web.url), declared = matchPeRoute(web.method, url.pathname)!;
    if (declared.id === "reads.events") return { readEvents: readEvents(publications, identity.caller, web) };
    if (declared.id === "resources.subscriptions") return { resourceOwner: connectionOwner };
    if (![...graphRouteIds, "work.get", "resources.stream"].includes(declared.id)) return {};
    const stream = declared.id === "resources.stream";
    const input = declared.route.input.parse({ params: declared.params,
      query: Object.fromEntries(url.searchParams), body: web.method === "GET" ? undefined : await web.clone().json() });
    const graph = graphRouteIds.includes(declared.id) ? graphRoute(declared.id, input.body) : null;
    const graphRequest = graph?.publication;
    if (graphRequest?.release) return { readGraph: async () => {
      publications.release(canonicalJson([identity.caller, graphRequest.subscription]), graphRequest.generation);
      return { key: "", generation: graphRequest.generation, version: 0, value: null, state: "superseded" };
    } };
    const recipe: ConsumerRecipe = { key: declared.id, input: json(graph ? { body: { read: graph.definition.name, args: graph.args } } : input), scope: canonicalJson(json(identity.scope)) };
    // Transport registration consumes no recording; POST-added keys admit their own frames.
    const consumption = recorded && stream ? undefined : await invoke(readSets.open(recipe, graph?.readSet as ReadSetId ?? null));
    const scoped = (current: InputConsumption): WorkInputRunner => (effect) =>
      runPods({}, Effect.provide(effect, Context.add(admitted, CurrentInputConsumption, current)));
    const complete = (current: InputConsumption) => scoped(current)(sealed(current));
    const activeFrames = new Map<InputConsumption, symbol>();
    let closingResources = false;
    const closeResources = () => { if (consumption && closingResources && !activeFrames.size) void invoke(consumption.close); };
    const finishFrame = async (current: InputConsumption) => {
      try { await invoke(current.close); }
      finally { activeFrames.delete(current); closeResources(); }
    };
    const inventory = Context.get(services, HostSessionInventory);
    const sources = (current: InputConsumption): DuctsReadSources => {
      const context = Context.add(admitted, CurrentInputConsumption, current);
      const invoke = <A, E>(effect: Effect.Effect<A, E, RequestIdentityKey | HostNativeRead>) => runPods({}, Effect.provide(effect, context));
      const documents = new Map<string, ReturnType<typeof inventory.document>>();
      const documentRead: typeof inventory.document = (ref) => Effect.gen(function* () {
        const key = JSON.stringify(ref);
        let read = documents.get(key);
        if (!read) { read = yield* Effect.cached(inventory.document(ref)); documents.set(key, read); }
        return yield* read;
      });
      const document = (ref: import("@pe/agent-contracts").DocumentRef) => invoke(documentRead(ref));
      return { firm: () => invoke(files.firm), catalogs: () => invoke(files.ductCatalogs),
        workKey: async (ref) => bindWork("ducts", (await document(ref)).address, undefined, ref),
        inputs: { consumption: current, run: scoped(current), work: workReadContext(current, scoped(current)) },
        call: async (key, input, ref, version, role) => {
          const scope = { bridgeSessionId: ref.session, ...(key === "ducts.tables" ? {} : { openDocumentId: ref.openId }) };
          return HttpServerResponse.toWeb(await invoke(retained(current, { key, input, scope }, { version }, role, documentRead)));
        },
      };
    };
    const observeFrame = (reading: Parameters<ResourceObserver>[0], publish: Parameters<ResourceObserver>[1],
      after: Parameters<ResourceObserver>[2], recordedFrame?: InputConsumption) => {
      if (!recorded && !["work", "work-acks", "ducts-snapshot", "ducts-tables", "inventory"].includes(reading.kind)) return fallback(reading, publish, after);
      class FrameCarriage extends WorkCarriage {
        constructor(readonly subscription?: ReadSetId, readonly envelope?: DuctsReadingEnvelope) { super(); }
      }
      const frameRuns = new WeakMap<WorkCarriage, WorkInputRunner>();
      const readyFrames = new Set<InputConsumption>();
      const frameOwner = Symbol();
      let released = false;
      const frameRecipe: ConsumerRecipe = { key: "resource.frame", input: json(reading), scope: recipe.scope };
      const frame = (recipe = frameRecipe) => {
        const current = recordedFrame ?? child(consumption!, recipe);
        activeFrames.set(current, frameOwner);
        return current;
      };
      const work: WorkReadContext = { begin: (read) => {
        try {
          const current = frame();
          const run: WorkInputRunner = (effect) => scoped(current)(effect).finally(() => {
            if (released) return finishFrame(current);
            readyFrames.add(current);
          });
          const begun = workReadContext(current, run).begin(read);
          if (begun.ok && begun.carriage) frameRuns.set(begun.carriage, scoped(current));
          else void finishFrame(current);
          return begun;
        } catch (error) { return { ok: false, error }; }
      } };
      const retainedResource: ResourceObserver = (reading, publish) => {
      let closed = false, release = () => {};
      const key = readingKey(reading);
      if (reading.kind === "inventory") {
        let subscription: ReadSetId | undefined;
        const read = async () => {
          const current = subscription ? await invoke(readSets.open(frameRecipe, null)) : frame();
          activeFrames.set(current, frameOwner);
          try {
            if (subscription) await scoped(current)(current.linkReadSet("subscription", subscription));
            const result = await scoped(current)(Effect.provideService(Effect.result(inventory.list()), RequestIdentity, identity));
            if (!released) { await complete(current); subscription ??= current.id; }
            return result;
          } finally { await finishFrame(current); }
        };
        const fail = (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (!released) publish({ kind: "failure", key, error: message,
            failure: { kind: "failed", code: isDoorFailure(error) ? error.problem : "ReadingFailed", message } });
        };
        const accept = (result: import("@pe/runtime").OwnerValue<Awaited<ReturnType<typeof read>>>) => {
          if (released) return;
          if ("error" in result) { fail(Error(result.error)); return; }
          if (Result.isFailure(result.value)) fail(result.value.failure);
          else publish(resourceSnapshot(key, { value: result.value.success }));
        };
        if (recorded) { void read().then((value) => accept({ value })).catch(fail); return () => {}; }
        // ADR0029 shared native dispatch does not share metadata consumers: each keeps its own context.
        return new OwnerReads().observe(key, read, inventory.subscribe, accept);
      }
      if (reading.kind !== "ducts-snapshot" && reading.kind !== "ducts-tables") {
        publish({ kind: "failure", key, error: "Recording does not cover this reading owner",
          failure: { kind: "failed", code: "recording.coverage", message: "Recording does not cover this reading owner" } });
        return () => {};
      }
      const input = reading.kind === "ducts-snapshot"
        ? (() => { const { kind, target, ...args } = reading; return { key: reading.selector.kind === "roster" ? "ducts.snapshot.roster" : "ducts.snapshot.walk", input: args,
          scope: { bridgeSessionId: target.session, openDocumentId: target.openId } }; })()
        : (() => { const { kind, session, ...args } = reading; return { key: "ducts.tables", input: args, scope: { bridgeSessionId: session } }; })();
      const current = frame();
      void invoke(retained(current, input, {}, "acquire", inventory.document)).then(async (response) => {
        await HttpServerResponse.toWeb(response).body?.cancel();
        if (closed) { await finishFrame(current); return; }
        readyFrames.add(current);
        let first = true;
        if (!closed) release = owner.observe(reading, (value) => {
          try {
            // A notification observes an envelope, not another taking of the acquired native body.
            const carriage = new FrameCarriage(first ? undefined : current.id, value);
            first = false; frameRuns.set(carriage, scoped(current));
            publish(resourceSnapshot(key, { value }), carriage);
          } catch (error) {
            const failure = error as InvalidRead;
            publish({ kind: "failure", key, error: failure.message,
              failure: { kind: "failed", code: failure.problem ?? "ReadingFailed", message: failure.message } });
          }
        });
      }).catch(async (error) => {
        await finishFrame(current);
        if (!closed) publish({ kind: "failure", key, error: error.message,
          failure: { kind: "failed", code: error.problem ?? "ReadingFailed", message: error.message } });
      });
      return () => { closed = true; release(); };
      };
      const release = markReadings(marks, async (ref, key, at, carriage, update) => {
        const runFrame = carriage ? frameRuns.get(carriage) : undefined;
        if (!runFrame) {
          if (!ref) return null;
          if (!recorded && (!writer || writer.capture.truncated())) return invoke(marks.readFrame(ref, key, at));
          throw new InvalidRead({ message: "Resource frame lost its consumption context", status: 409, problem: "recording.context" });
        }
        return runFrame(Effect.gen(function* () {
          const active = yield* Effect.serviceOption(CurrentInputConsumption);
          if (Option.isNone(active)) return yield* new InvalidRead({ message: "Frame runner has no consumption", status: 409, problem: "recording.context" });
          const previous = active.value;
          const independent = !recorded && (update || (carriage instanceof FrameCarriage && !!carriage.subscription));
          const current = independent ? yield* readSets.open(carriage instanceof FrameCarriage && carriage.envelope
            ? { ...frameRecipe, key: "resource.notification", input: json({ reading, envelope: carriage.envelope }) }
            : previous.recipe, null) : previous;
          if (independent) activeFrames.set(current, frameOwner);
          readyFrames.delete(current);
          if (!update && carriage) frameRuns.set(carriage, scoped(current));
          return yield* Effect.tryPromise({ try: async () => {
            try {
              if (released) throw new InvalidRead({ message: "Resource subscription is closed", status: 409, problem: "recording.context" });
              if (update) await scoped(current)(current.linkReadSet("value", previous.id));
              else if (carriage instanceof FrameCarriage && carriage.subscription)
                await scoped(current)(current.linkReadSet("subscription", carriage.subscription));
              if (ref && writer && !writer.capture.truncated()) await scoped(current)(inventory.document(ref).pipe(
                Effect.provideService(RequestIdentity, identity), Effect.catch(() => {
                  const at = writer.capture.begin(); return at === null ? Effect.void : writer.capture.stop(at, "unsupported");
                })));
              const value = ref ? await scoped(current)(marks.readFrame(ref, key, at)) : null;
              if (!released) await complete(current);
              return value;
            } finally { await finishFrame(current); }
          }, catch: (error) => isDoorFailure(error) ? error : new InvalidRead({ message: String(error), status: 409, problem: "recording.context" }) });
        }));
      })(observeResources(workspace, undefined, retainedResource, work))(reading, publish, after);
      return () => {
        released = true; release();
        for (const current of readyFrames) void finishFrame(current);
        readyFrames.clear();
        if (writer?.capture.truncated()) for (const [current, owner] of activeFrames)
          if (owner === frameOwner) void finishFrame(current);
      };
    };
    const observe: ResourceObserver = (reading, publish, after) => {
      if (!recorded) return observeFrame(reading, publish, after);
      let released = false, release = () => {};
      void invoke(readSets.open({ key: "resource.frame", input: json(reading), scope: recipe.scope }, null)).then(async (current) => {
        if (released) { await invoke(current.close); return; }
        try {
          const stop = observeFrame(reading, (frame, carriage) => {
            if (frame.kind !== "failure") { publish(frame, carriage); return; }
            void finishFrame(current).then(() => { if (!released) publish(frame, carriage); });
          }, after, current);
          release = () => { stop(); void finishFrame(current); };
        } catch (error) { await finishFrame(current); throw error; }
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!released) publish({ kind: "failure", key: readingKey(reading), error: message,
          failure: { kind: "failed", code: isDoorFailure(error) ? error.problem : "ReadingFailed", message } });
      });
      return () => { released = true; release(); };
    };
    const source = consumption ? sources(consumption) : undefined;
    return { ...(graph && source ? { readGraph: async () => {
      const port = ductsInputPort({ source, workspace, marks, run: scoped(consumption!),
        evaluation: consumption!.id, origin: () => inputs.source, revision: invalidations.revision });
      return graph.publication
        ? publications.publish(canonicalJson([identity.caller, graph.publication.subscription]), graph.publication.generation, graph.definition, graph.args, port)
        : (await evaluate(graph.definition, graph.args, port)).data;
    } } : {}), ...(source && { work: source.inputs!.work,
      document: (ref: import("@pe/agent-contracts").DocumentRef) => runPods({}, Effect.provide(inventory.document(ref), Context.add(admitted, CurrentInputConsumption, consumption!))) }), observe,
      closeResources: () => { closingResources = true; closeResources(); },
      resourceOwner: connectionOwner,
      finish: async (result) => {
        if (stream) {
          if (consumption && ("error" in result || !result.response.ok)) await invoke(consumption.close);
          return;
        }
        try { if ("response" in result && result.response.ok) {
          await complete(consumption!);
        } } catch {
          const at = writer?.capture.begin();
          if (at != null) await invoke(writer!.capture.stop(at, "io"));
        }
        finally { if (consumption) await invoke(consumption.close); }
      },
    };
  };
  const retainedCall = (raw: NativeReadInput, readOptions: { version?: string; refresh?: string }) => Effect.gen(function* () {
      raw = { ...raw, scope: JSON.parse(JSON.stringify(raw.scope)) };
      const missing = inputs.check({ kind: "input", input: "document" });
      if (missing) return yield* missing;
      const inventory = Context.get(services, HostSessionInventory);
      const root = yield* readSets.open({ key: "native.call", input: json({ ...raw, version: readOptions.version ?? null,
        refresh: readOptions.refresh ?? null }), scope: canonicalJson(raw.scope) }, null);
      return yield* Effect.gen(function* () {
        const selected = raw.scope.bridgeSessionId ? { ...raw.scope,
          bridgeSessionId: (yield* inventory.attachment(raw.scope.bridgeSessionId)).sessionId } : raw.scope;
        const session = yield* inventory.session(selected);
        const { openDocumentId, ...scope } = selected;
        const response = yield* retained(root, { ...raw, scope: { ...scope, bridgeSessionId: session.sessionId,
          ...(raw.key === 'ducts.tables' ? {} : { openDocumentId }) } }, readOptions, "acquire", inventory.document);
        if (writer && !writer.capture.truncated() && openDocumentId && raw.key !== "ducts.tables")
          yield* inventory.document({ session: session.sessionId, openId: openDocumentId }).pipe(Effect.catch(() => {
            const at = writer.capture.begin(); return at === null ? Effect.void : writer.capture.stop(at, "unsupported");
          }));
        return response;
      }).pipe(Effect.tap(() => sealed(root)), Effect.ensuring(root.close), Effect.provideService(CurrentInputConsumption, root),
        Effect.provideService(HostNativeRead, Context.get(services, HostNativeRead)));
    });
  const work = { workspace, registrations, pointers: options.pointers };
  const nativeCall = Effect.fn("Reads.nativeBody")(function* (raw: NativeReadInput) {
    const { answer } = yield* nativeBody(raw, Context.get(services, HostNativeRead).read(raw));
    return HttpServerResponse.jsonUnsafe(answer.value, { headers: { "x-pe-native-request-id": answer.nativeRequestId,
      } });
  });
  const nativeBody = Effect.fn("Reads.nativeBodyCapture")(function* (raw: NativeReadInput, read: Effect.Effect<import("@pe/host-internal/request-contracts").NativeAnswer<Schema.Json>, import("@pe/host-internal/request-contracts").DoorFailure, RequestIdentityKey | HostNativeRead>) {
    const root = yield* readSets.open({ key: "native.call", input: json(raw), scope: canonicalJson(raw.scope) }, null);
    return yield* Effect.gen(function* () {
      const answer = yield* read;
      if (writer && "openId" in answer.actualTarget.openDocumentLifetime) {
        const inventory = Context.get(services, HostSessionInventory);
        const openId = answer.actualTarget.openDocumentLifetime.openId;
        yield* Effect.gen(function* () {
          const session = yield* inventory.session(raw.scope);
          yield* inventory.document({ session: session.sessionId, openId });
        }).pipe(Effect.catch(() => {
          const at = writer.capture.begin(); return at === null ? Effect.void : writer.capture.stop(at, "unsupported");
        }));
      }
      yield* sealed(root);
      return { answer };
    }).pipe(Effect.provideService(CurrentInputConsumption, root), Effect.provideService(HostNativeRead, Context.get(services, HostNativeRead)), Effect.ensuring(root.close));
  });
  return { work, invocation, retainedCall, nativeCall, nativeBody, services, publications };
});

type ReadOwnerOptions = NonNullable<Parameters<typeof makeReadOwner>[1]>;

class ReadOwner extends Context.Service<ReadOwner, Effect.Success<ReturnType<typeof makeReadOwner>>>()("pe/ReadOwner") {}

const readCoreRoutes = (inputs: HostInputContext["Service"], options: Parameters<typeof makeReadOwner>[1] = {}) =>
  Layer.unwrap(Effect.gen(function* () {
    const reads = yield* makeReadOwner(inputs, options);
    const routes = createPeRoutes({ inputs, workspace: reads.work.workspace, registrations: reads.work.registrations });
    return Layer.mergeAll(peCoreRoutes(routes, reads.invocation, inputs), nativeReadResolveRoute,
      nativeCallRouteFor(reads.retainedCall, reads.nativeCall),
    ).pipe(HttpRouter.provideRequest(Layer.succeedContext(Context.add(reads.services, HostInputContext, inputs))),
      Layer.provide(Layer.succeedContext(Context.add(reads.services, HostInputContext, inputs))));
  }));

export const readInputRoutes = (inputs: HostInputContext["Service"], options: Parameters<typeof makeReadOwner>[1] = {}) =>
  Layer.mergeAll(readCoreRoutes(inputs, options), HttpRouter.add("*", "/*", () => recordingCoverage)).pipe(Layer.provide(httpProblems));

/** Root-fixed selection: the live factory is not even called on a historical/fixture lane. */
export const hostInputGraph = <A, E, R, B, F, S>(inputs: HostInputContext["Service"], live: () => Layer.Layer<A, E, R>, recording: () => Layer.Layer<B, F, S>): Layer.Layer<A & B, E | F, R | S> =>
  inputs.lane.kind === "live" ? live() : recording();

/** Both source graphs retire browser sockets after the platform listener closes. */
const hostServerLayer = (server: Server, port: number) => NodeHttpServer.layer(() => server, {
  host: "127.0.0.1", port, disablePreemptiveShutdown: true,
}).pipe(Layer.provide(Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(() => {
  server.closeIdleConnections(); server.closeAllConnections();
})))));

function historicalHttpLive(options: HttpLiveOptions) {
  const server = options.nodeServer ?? createServer();
  const port = () => { const address = server.address(); return address && typeof address !== "string" ? address.port : options.port; };
  const identity = requestIdentityLayer({
    port, frontendOrigin: Effect.succeed(undefined),
    // TODO: map this historical wrong-Host denial through typed identity failure; today it becomes a fail-closed defect.
    share: { read: async () => { throw new Refused({ code: "context.missing", door: "historical host", reason: "Historical host admits local transport only" }); }, observe: () => {} },
  });
  return ServiceFileLive.pipe(Layer.provideMerge(HttpRouter.serve(historicalRoutes(options.inputs, options.webRoot).pipe(
    Layer.provide(identity),
  )).pipe(Layer.provideMerge(hostServerLayer(server, options.port)))),
    Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)), Layer.provide(NodeServices.layer));
}

export interface HttpLiveOptions {
  /** Preferred listen port (0 = ephemeral, used by the boundary test). */
  readonly inputs: HostInputContext["Service"];
  readonly port: number;
  readonly capabilities: PeaRuntimeCapabilities;
  /** Injected listener for socket lifecycle tests. */
  readonly nodeServer?: Server;
  readonly share?: ShareOwner;
  readonly devices?: Devices;
  readonly remoteIngress?: readonly { origin: string; transport: "lan" | "ssh" }[];
  /** Browser origin of the separately owned dev frontend. API requests stay here. */
  readonly webUrl?: Deferred.Deferred<string>;
  /** Boot-scoped shutdown latch + service token, injected by the launch root. */
  readonly lifecycle: HostLifecycle["Service"];
  readonly updateReader?: UpdateReader["Service"];
  /** The spine's intake for update facts, handed to the reader this app builds. */
  readonly updateFact?: (fact: UpdateFact) => void;
  /**
   * The launch root's exporter, so the boot record and update facts share it with the routes; a
   * composition without one builds its own `ReceiptExport` layer for this app's scope.
   */
  readonly receipts?: ReceiptExporter;
  /** Built SPA directory, or null to skip static serving (dev/vite). */
  readonly webRoot: string | null;
  /** Route registrations for the host-owned route surface; tests inject their own. */
  readonly routeRegistrations?: Parameters<typeof peRoutesLayer>[0];
  /** Test sentinel for the complete Revit/SDK/proxy composition. */
  readonly revitCompositionFactory?: typeof makeRevitComposition;
  /** Explicit primitive input ports; the HTTP, Work and retained owners remain the production graph. */
  readonly reads?: Omit<ReadOwnerOptions, "live"> & {
    readonly live?: Omit<NonNullable<ReadOwnerOptions["live"]>, "owner">;
  };
}

/**
 * Assemble the full host app + server as one launchable Layer. `port` is a parameter so the
 * boundary test can boot the real composition on an ephemeral port. HttpServer is provided once
 * (via `NodeHttpServer.layer`) and shared by the router and the service-file writer.
 */
export function makeHttpLive(options: HttpLiveOptions) {
  return hostInputGraph(options.inputs, () => liveHttpLive(options), () => historicalHttpLive(options));
}

function liveHttpLive(options: HttpLiveOptions) {
  const ReceiptsLive = options.receipts
    ? Layer.succeed(ReceiptExport, options.receipts)
    : ReceiptExport.layer({ host: null, web: null });
  const UpdateLive = Layer.succeed(
    UpdateReader,
    options.updateReader ?? makeInstalledUpdateReader(options.updateFact),
  );
  const nodeServer = options.nodeServer ?? createServer();
  // Both lanes wait for explicit reads until completion or disconnect; upload limits stay intact.
  nodeServer.setTimeout(0);
  const remoteConfig = readRemoteIngress(
    join(hostOwnership.rootPath, "state", hostOwnership.serviceName, "remote-ingress.json"),
  );
  const remoteRequests = new WeakSet<object>();
  const remote = remoteConfig ? remoteListener(nodeServer, remoteRequests) : null;
  const RemoteLive =
    remote && remoteConfig
      ? Layer.effectDiscard(
          Effect.acquireRelease(
            Effect.promise(() => remote.start(remoteConfig.listenHost, remoteConfig.port)),
            () => Effect.promise(() => remote.close()),
          ),
        )
      : Layer.empty;
  const ServerLive = hostServerLayer(nodeServer, options.port);

  const port = () => {
    const address = nodeServer.address();
    return address && typeof address !== "string" ? address.port : options.port;
  };
  const registrations = [
    ...(options.routeRegistrations ?? createRouteRegistrations)({
      loadedFamilies: (...args) => hostLoadedFamilies(`http://127.0.0.1:${port()}`)(...args),
    }),
    // Route-free catalog owners: Work with no Page (ADR 0030 rule 2). Pea's doors list them like any Work.
    ...Object.values(catalogWorkSpecs).map((spec) => ({ spec })),
  ];
  const share =
    options.share ??
    createShare({
      installed: hostOwnership.lane === "installed",
      port,
      run: tailscaleCommand(),
      ...shareIntentFile(join(hostOwnership.rootPath, "state", "share.json")),
    });
  const devices =
    options.devices ??
    createDevices(join(hostOwnership.rootPath, "state", hostOwnership.serviceName, "devices.json"));
  bindControl({ deviceThread: (device) => devices.active(device).thread });
  const identity = requestIdentityLayer({
    devices,
    remoteRequests,
    remoteIngress: options.remoteIngress ?? remoteConfig?.origins,
    port,
    // Read on each request's fiber: the dev frontend's URL settles after the layer is built.
    frontendOrigin: options.webUrl
      ? Deferred.poll(options.webUrl).pipe(
          Effect.flatMap(
            Option.match({ onNone: () => Effect.succeed(undefined), onSome: (url) => url }),
          ),
        )
      : Effect.succeed(undefined),
    share,
  }).pipe(Layer.provide(peApiErrorsLayer));

  const webUrl = options.webUrl;
  const webRoot = options.webRoot;
  const spa: SpaFallback = webUrl
    ? (req) => Effect.map(Deferred.await(webUrl), (url) => Response.redirect(url + req.originalUrl))
    : webRoot
      ? () => Effect.sync(() => Response.html(readFileSync(join(webRoot, "index.html"), "utf8")))
      : () => emptyNotFound;
  const revit = options.capabilities.revit;
  const composition = revit
    ? (options.revitCompositionFactory ?? makeRevitComposition)(
        spa,
        () => `http://127.0.0.1:${port()}`,
      )
    : {
        provider: RevitBridgeLive,
        routes: Layer.mergeAll(
          noRevitBoundary(),
          Layer.unwrap(
            Effect.gen(function* () {
              const { work, retainedCall, nativeBody } = yield* ReadOwner;
              return makeCallRoute(
                (yield* HostReceipts).journal,
                undefined,
                { workspace: work.workspace },
                { origin: () => `http://127.0.0.1:${port()}`, pointers: work.pointers, retainedRead: retainedCall, nativeBody },
              );
            }),
          ),
          opsCatalogRoute(spa),
          noRevitHostStatusRoute,
        ),
      };
  const AppRoutes = Layer.unwrap(Effect.gen(function* () {
    const live = options.reads?.live ?? {
      native: Layer.succeed(HostNativeRead, yield* HostNativeRead),
      files: Layer.succeed(DuctFiles, yield* DuctFiles), marks: Layer.succeed(HostDocumentMarks, yield* HostDocumentMarks),
      inventory: Layer.succeed(HostSessionInventory, yield* HostSessionInventory.pipe(Effect.provide(HostSessionInventory.layer))),
    };
    const reads = yield* makeReadOwner(options.inputs, { registrations, pointers: threadPointerPort(options.inputs),
      ...options.reads, store: options.reads?.store ?? fileRouteDocumentStore(productRouteWorkPath()),
      live: { ...live, owner: ductsReadings(yield* RevitBridge) } });
    const work = reads.work;
    const CommonAppLive = Layer.mergeAll(
      RemoteLive,
      shareRoute(share),
      deviceRoutes(devices),
      mcpRoute(() => `http://127.0.0.1:${port()}`),
      capturesRoute(spa),
      pagesRoute(),
      ductCatalogsRoute,
      adminShutdownRoute,
      adminWindowRoute,
      updateRoutes,
      peRoutesLayer(options.routeRegistrations, share, work, reads.invocation),
      demoRoutes(),
      webUrl
        ? HttpRouter.add("GET", "/*", (req) => (isNavigation(req) ? spa(req) : emptyNotFound))
        : staticSpaLayer(options.webRoot),
    );

    const context = Context.add(Context.add(reads.services, ReadOwner, reads), HostInputContext, options.inputs);
    return Layer.mergeAll(composition.routes, CommonAppLive).pipe(
      HttpRouter.provideRequest(Layer.succeedContext(context)), Layer.provide(Layer.succeedContext(context)));
  }));
  // The request handler is installed before publishing the claim. Readers and marks close
  // before the bridge; the composing runtime owns receipts beyond all of these resources.
  return ServiceFileLive.pipe(
    Layer.provideMerge(
      HttpRouter.serve(
        AppRoutes.pipe(
          Layer.provide(identity), nativeReadRoot(SdkDriverLive, options.inputs),
        ),
      ).pipe(Layer.provideMerge(ServerLive)),
    ),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(FamiliesReader.layer),
    Layer.provide(HostDocumentMarks.layer),
    Layer.provide(composition.provider),
    Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
    Layer.provide(UpdateLive),
    Layer.provide(RunConsents.layer),
    Layer.provide(Spawner.live),
    Layer.provide(CaptureStore.layer()),
    Layer.provide(DuctFiles.layer()),
    Layer.provide(PictureCaptureStore.layer()),
    Layer.provide(ReceiptsLive),
    Layer.provide(NodeServices.layer),
  );
}
