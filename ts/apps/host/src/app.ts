import { HostInputContext } from "./input-context.ts";
import type { TakingObserver } from "./native-recording.ts";
import { recordedWorkSource, capturedWorkReads, workReadContext, type WorkInputRunner } from "./work-inputs.ts";
import { CurrentInputConsumption, HostInputReadSets, type InputConsumption, type ReadSetId, type ConsumerRecipe } from "./input-occurrence.ts";
import type { DuctsSheetSources } from "./ducts-sheet.ts";
import { matchPeRoute, peRoutes } from "@pe/agent-contracts/pe-api";
import { HostSessionInventory } from "./session-inventory.ts";
import { createDuctsBodyBasis } from "./ducts-body-basis.ts";
import { DuctsReadings, ductsReadings } from "./ducts-readings.ts";
import { createPeRoutes, peCoreRoutes, type PeInvocationFactory } from "./pe-routes.ts";
import { runPods } from "./family-actions.ts";
import { bindWork, readingKey, readingRequestsSchema, ductsReadingEnvelopeSchema, type DuctsReadingEnvelope } from "@pe/agent-contracts";
import { observeResources, resourceSnapshot, WorkCarriage, type ResourceObserver, type WorkReadContext } from "@pe/runtime";
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
import { ductCatalogsRoute, HostFiles } from "./host-files.ts";
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
          const { work, retainedCall } = yield* FansOwner;
          return makeCallRoute(
            (yield* HostReceipts).journal,
            undefined,
            { workspace: work.workspace },
            { origin, families, pointers: work.pointers, retainedRead: retainedCall },
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

export const historicalRoutes = (inputs: HostInputContext["Service"]) => fansInputRoutes(inputs);

/** One Fans HTTP/Work graph; live uses the bridge-subscribed retained owner, replay builds no live port. */
export const makeFansOwner = Effect.fn("Fans.compose")(function* (inputs: HostInputContext["Service"], options: {
  readonly live?: { owner: DuctsReadings; native: Layer.Layer<HostNativeRead>; files: Layer.Layer<HostFiles>;
    marks: Layer.Layer<HostDocumentMarks>; inventory: Layer.Layer<HostSessionInventory> };
  readonly store?: import("@pe/runtime").RouteDocumentStore;
  readonly observed?: TakingObserver;
  readonly readSet?: ReadSetId;
  readonly observedReadSet?: (recipe: ConsumerRecipe, id: ReadSetId, requestId: string | undefined, caller: import("@pe/agent-contracts").Caller | undefined) => void;
  readonly initialize?: (workspace: RouteWorkspace) => Promise<void>;
  readonly registrations?: HostWork["registrations"];
  readonly pointers?: HostWork["pointers"];
} = {}) {
  const runtime = yield* Effect.context<never>();
  const lane = inputs.lane;
  if (lane.kind === "fixture") return yield* Effect.die(Error("A fixture has no Fans input graph"));
  const basis = createDuctsBodyBasis(lane, options.observed);
  const recorded = lane.kind === "recording";
  const live = recorded ? undefined : options.live;
  if (!recorded && (!live || !options.store)) return yield* Effect.die(Error("Live Fans graph needs its real live inputs and Work store"));
  const writer = lane.kind === "live" ? lane.captureStore : undefined;
  const services = yield* Layer.build(Layer.mergeAll(
    HostInputReadSets.layer(lane),
    guardedNativeRead().pipe(Layer.provide(hostNativeReadFor(lane, recorded ? liveNativeRecipe : live!.native, basis?.observed)), Layer.provide(Layer.succeed(HostInputContext, inputs))),
    recorded ? HostFiles.recorded(lane.recordingStore) : writer ? HostFiles.capturing(writer, options.observed).pipe(Layer.provide(live!.files)) : live!.files,
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
  const files = Context.get(services, HostFiles), marks = Context.get(services, HostDocumentMarks);
  const readSets = Context.get(services, HostInputReadSets);
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
        Effect.tap(() => sealed(nested)), Effect.ensuring(nested.close), Effect.provideService(CurrentInputConsumption, nested));
    });
  const invocation: PeInvocationFactory = async (request, web, fallback) => {
    const identity = Context.get(request, RequestIdentity);
    const admitted = Context.add(provided, RequestIdentity, identity);
    const invoke = <A, E>(effect: Effect.Effect<A, E, RequestIdentityKey | HostNativeRead>) => runPods({}, Effect.provide(effect, admitted));
    const url = new URL(web.url), declared = matchPeRoute(web.method, url.pathname)!;
    if (!["ducts.roster", "ducts.sheet", "work.get", "resources.stream"].includes(declared.id)) return {};
    const stream = declared.id === "resources.stream";
    const reading = stream ? readingRequestsSchema.parse(JSON.parse(url.searchParams.get("keys") ?? "[]")) : [];
    if (recorded && stream && reading.length !== 1)
      throw new InvalidRead({ message: "A recorded resource request needs one exact frame read set", status: 409, problem: "recording.context" });
    const input = stream && recorded ? reading[0] : declared.route.input.parse({ params: declared.params,
      query: Object.fromEntries(url.searchParams), body: web.method === "GET" ? undefined : await web.clone().json() });
    const selected = recorded && stream && options.readSet ? await invoke(lane.recordingStore.readSets.get(options.readSet)) : undefined;
    const notification = selected?.recipe.key === "resource.notification" ? await invoke(Effect.try({
      try: () => {
        const saved = Schema.decodeUnknownSync(Schema.Struct({ reading: Schema.Json, envelope: Schema.Json }))(selected.recipe.input);
        return { ...saved, envelope: ductsReadingEnvelopeSchema.parse(saved.envelope) };
      },
      catch: () => new InvalidRead({ message: "Recorded resource notification is malformed", status: 409, problem: "recording.mismatch" }),
    })) : undefined;
    const recipe: ConsumerRecipe = { key: notification ? "resource.notification" : stream && recorded ? "resource.frame" : declared.id,
      input: notification ? json({ reading: input, envelope: notification.envelope }) : json(input),
      scope: canonicalJson(json(identity.scope)) };
    const consumption = await invoke(readSets.open(recipe, options.readSet ?? null));
    const scoped = (current: InputConsumption): WorkInputRunner => (effect) =>
      runPods({}, Effect.provide(effect, Context.add(admitted, CurrentInputConsumption, current)));
    const complete = (current: InputConsumption) => scoped(current)(sealed(current));
    const activeFrames = new Set<InputConsumption>();
    let closingResources = false;
    const closeResources = () => { if (closingResources && !activeFrames.size) void invoke(consumption.close); };
    const finishFrame = async (current: InputConsumption) => {
      try { await invoke(current.close); }
      finally { activeFrames.delete(current); closeResources(); }
    };
    const inventory = Context.get(services, HostSessionInventory);
    const sources = (current: InputConsumption): DuctsSheetSources => {
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
        inputs: { consumption: current, run: scoped(current), work: workReadContext(current, scoped(current)),
          overview: async (basis, recompute) => {
            if (lane.kind !== "recording") throw new InvalidRead({ message: "Original overview is no longer retained", status: 409, problem: "read.retained" });
            const id = await invoke(current.dependency("overview"));
            const saved = await invoke(lane.recordingStore.readSets.get(id));
            if (saved.recipe.key !== "ducts.sheet" || !saved.exports.some((value) => value.kind === "ducts.sheet" && value.basis === basis))
              throw new InvalidRead({ message: "Overview dependency does not export this sheet basis", status: 409, problem: "recording.mismatch" });
            const original = peRoutes["ducts.sheet"].input.parse(saved.recipe.input).body;
            const opened = await invoke(readSets.open(saved.recipe, id));
            try { await recompute(original, sources(opened)); await complete(opened); }
            finally { await invoke(opened.close); }
          },
        },
        call: async (key, input, ref, version, role) => {
          const scope = { bridgeSessionId: ref.session, ...(key === "ducts.tables" ? {} : { openDocumentId: ref.openId }) };
          return HttpServerResponse.toWeb(await invoke(retained(current, { key, input, scope }, { version }, role, documentRead)));
        },
      };
    };
    const observe: ResourceObserver = (reading, publish, after) => {
      if (!recorded && !["work", "work-acks", "ducts-snapshot", "ducts-tables"].includes(reading.kind)) return fallback(reading, publish, after);
      class FrameCarriage extends WorkCarriage {
        constructor(readonly subscription?: ReadSetId, readonly envelope?: DuctsReadingEnvelope) { super(); }
      }
      const frameRuns = new WeakMap<WorkCarriage, WorkInputRunner>();
      const readyFrames = new Set<InputConsumption>();
      let released = false;
      const frameRecipe: ConsumerRecipe = { key: "resource.frame", input: json(reading), scope: recipe.scope };
      const frame = (recipe = frameRecipe) => {
        const current = recorded ? consumption : child(consumption, recipe);
        activeFrames.add(current);
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
      if (notification) {
        readyFrames.add(current);
        const carriage = new FrameCarriage(); frameRuns.set(carriage, scoped(current));
        publish(resourceSnapshot(key, { value: notification.envelope }), carriage);
        return () => {};
      }
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
          if (independent) activeFrames.add(current);
          readyFrames.delete(current);
          if (!update && carriage) frameRuns.set(carriage, scoped(current));
          return yield* Effect.tryPromise({ try: async () => {
            try {
              if (released) throw new InvalidRead({ message: "Resource subscription is closed", status: 409, problem: "recording.context" });
              if (update) await scoped(current)(current.linkReadSet("value", previous.id));
              else if (carriage instanceof FrameCarriage && carriage.subscription)
                await scoped(current)(current.linkReadSet("subscription", carriage.subscription));
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
        if (writer?.capture.truncated()) for (const current of activeFrames) void finishFrame(current);
      };
    };
    const source = sources(consumption);
    return { sheets: source, work: source.inputs!.work,
      closeResources: () => { closingResources = true; closeResources(); },
      document: (ref) => runPods({}, Effect.provide(inventory.document(ref), Context.add(admitted, CurrentInputConsumption, consumption))), observe,
      finish: async (result) => {
        if (stream) {
          if ("error" in result || !result.response.ok) await invoke(consumption.close);
          return;
        }
        try { if ("response" in result && result.response.ok) await complete(consumption); }
        finally { await invoke(consumption.close); }
      },
    };
  };
  const retainedCall = (raw: NativeReadInput, readOptions: { version?: string; refresh?: string }) => Effect.gen(function* () {
      raw = { ...raw, scope: JSON.parse(JSON.stringify(raw.scope)) };
      const missing = inputs.check({ kind: "input", input: "document" });
      if (missing) return yield* missing;
      const inventory = Context.get(services, HostSessionInventory);
      const root = yield* readSets.open({ key: "native.call", input: json({ ...raw, version: readOptions.version ?? null,
        refresh: readOptions.refresh ?? null }), scope: canonicalJson(raw.scope) }, options.readSet ?? null);
      return yield* Effect.gen(function* () {
        const selected = raw.scope.bridgeSessionId ? { ...raw.scope,
          bridgeSessionId: (yield* inventory.attachment(raw.scope.bridgeSessionId)).sessionId } : raw.scope;
        const session = yield* inventory.session(selected);
        const { openDocumentId, ...scope } = selected;
        return yield* retained(root, { ...raw, scope: { ...scope, bridgeSessionId: session.sessionId,
          ...(raw.key === 'ducts.tables' ? {} : { openDocumentId }) } }, readOptions, "acquire", inventory.document);
      }).pipe(Effect.tap(() => sealed(root)), Effect.ensuring(root.close), Effect.provideService(CurrentInputConsumption, root),
        Effect.provideService(HostNativeRead, Context.get(services, HostNativeRead)));
    });
  const work = { workspace, registrations, pointers: options.pointers };
  return { work, invocation, retainedCall, services };
});

type FansOwnerOptions = NonNullable<Parameters<typeof makeFansOwner>[1]>;

class FansOwner extends Context.Service<FansOwner, Effect.Success<ReturnType<typeof makeFansOwner>>>()("pe/FansOwner") {}

export const fansInputRoutes = (inputs: HostInputContext["Service"], options: Parameters<typeof makeFansOwner>[1] = {}) =>
  Layer.unwrap(Effect.gen(function* () {
    const fans = yield* makeFansOwner(inputs, options);
    const routes = createPeRoutes({ inputs, workspace: fans.work.workspace, registrations: fans.work.registrations });
    return Layer.mergeAll(peCoreRoutes(routes, fans.invocation, inputs), nativeReadResolveRoute,
      nativeCallRouteFor(fans.retainedCall),
      HttpRouter.add('*', '/*', () => Effect.fail(new InvalidRead({ message: 'Recording does not cover this owner', status: 409, problem: 'recording.coverage' }))),
    ).pipe(HttpRouter.provideRequest(Layer.succeedContext(Context.add(fans.services, HostInputContext, inputs))),
      Layer.provide(Layer.succeedContext(Context.add(fans.services, HostInputContext, inputs))), Layer.provide(httpProblems));
  }));

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
    share: { read: async () => { throw new Refused({ code: "context.missing", door: "historical host", reason: "Historical host admits local transport only" }); }, observe: () => {} },
  });
  return ServiceFileLive.pipe(Layer.provideMerge(HttpRouter.serve(historicalRoutes(options.inputs).pipe(
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
  readonly fans?: Omit<FansOwnerOptions, "live"> & {
    readonly live?: Omit<NonNullable<FansOwnerOptions["live"]>, "owner">;
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
              const { work, retainedCall } = yield* FansOwner;
              return makeCallRoute(
                (yield* HostReceipts).journal,
                undefined,
                { workspace: work.workspace },
                { origin: () => `http://127.0.0.1:${port()}`, pointers: work.pointers, retainedRead: retainedCall },
              );
            }),
          ),
          opsCatalogRoute(spa),
          noRevitHostStatusRoute,
        ),
      };
  const AppRoutes = Layer.unwrap(Effect.gen(function* () {
    const live = options.fans?.live ?? {
      native: Layer.succeed(HostNativeRead, yield* HostNativeRead),
      files: Layer.succeed(HostFiles, yield* HostFiles), marks: Layer.succeed(HostDocumentMarks, yield* HostDocumentMarks),
      inventory: Layer.succeed(HostSessionInventory, yield* HostSessionInventory.pipe(Effect.provide(HostSessionInventory.layer))),
    };
    const fans = yield* makeFansOwner(options.inputs, { registrations, pointers: threadPointerPort(options.inputs),
      ...options.fans, store: options.fans?.store ?? fileRouteDocumentStore(productRouteWorkPath()),
      live: { ...live, owner: ductsReadings(yield* RevitBridge) } });
    const work = fans.work;
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
      peRoutesLayer(options.routeRegistrations, share, work, fans.invocation),
      demoRoutes(),
      webUrl
        ? HttpRouter.add("GET", "/*", (req) => (isNavigation(req) ? spa(req) : emptyNotFound))
        : staticSpaLayer(options.webRoot),
    );

    const context = Context.add(Context.add(fans.services, FansOwner, fans), HostInputContext, options.inputs);
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
    Layer.provide(HostFiles.layer()),
    Layer.provide(PictureCaptureStore.layer()),
    Layer.provide(ReceiptsLive),
    Layer.provide(NodeServices.layer),
  );
}
