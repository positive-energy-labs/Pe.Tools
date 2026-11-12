import { admitNativeCaller } from "./native-read-policy.ts";
import { captureInput, replayInput, nativeInputIdentity, type RecordedInput } from "./native-recording.ts";
import { CaptureStore } from "./takeoff-captures.ts";
import { takeoffSnapshotInput } from "../../web/src/takeoff/host.ts";
import { projectTakeoffSnapshot } from "@pe/mcps/takeoff-ops";
import { readLocal } from "./local-inputs.ts";
import { readFamilySpec } from "./family-file-input.ts";
import { PictureCaptureStore } from "./captures-route.ts";
import { createHash } from "node:crypto";
import { nativeOutputLayer } from "./native-output.ts";
import { hostOpSafety } from "@pe/host-contracts/generated";
import {
  executionTargetSchema,
  documentRefSchema,
  NATIVE_BODY_VERSION_HEADER,
  readingRequestSchema,
} from "@pe/agent-contracts";
import { HostInputContext } from "./input-context.ts";
import {
  CurrentInputConsumption,
  HostInputReadSets,
  type ConsumerRecipe,
  type InputConsumption,
  type ReadSetId,
} from "./input-occurrence.ts";
import type { TakingObserver } from "./native-recording.ts";
import { inputPort, type ReadSources } from "./reads/inputs.ts";
import { Publications, fingerprint } from "./reads/evaluator.ts";
import { History, localHistory } from "./reads/history.ts";
import { historyRoutes } from "./reads/history-routes.ts";
import { historyPoseSchema, addressSchema, sameAddress } from "@pe/agent-contracts";
import { ActionJournalService } from "./receipt-services.ts";
import { readInvalidations } from "./reads/invalidations.ts";
import { graphRoute, graphRouteIds, registeredReads } from "./reads/routes.ts";
import { ResourceConnectionOwner } from "./request-services.ts";
import {
  capturedWorkReads,
  recordedWorkSource,
  workReadContext,
  type WorkInputRunner,
} from "./work-inputs.ts";

import { bindWork, readingKey, type DuctsReadingEnvelope } from "@pe/agent-contracts";
import { matchPeRoute } from "@pe/agent-contracts/pe-api";
import { canonicalJson, HostNativeRead, type NativeReadInput } from "@pe/host-internal/native-read";
import type { RequestIdentity as RequestIdentityKey } from "@pe/host-internal/request-contracts";
import { createRouteRegistrations } from "@pe/mcps";
import {
  observeResources,
  OwnerReads,
  resourceSnapshot,
  RouteWorkspace,
  WorkCarriage,
  type ResourceObserver,
  type WorkReadContext,
} from "@pe/runtime";
import { Context, Effect, Layer, Option, Result, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { admittedBuiltinsLayer, constructorWorkRegistrations } from "./admitted-builtins.ts";
import { RevitBridge } from "./bridge.ts";
import { nativeCallRouteFor, nativeReadResolveRoute, retainedDuctsRead } from "./call-route.ts";
import { HostDocumentMarks } from "./document-marks.ts";
import { createDuctsBodyBasis } from "./ducts-body-basis.ts";
import { ductCatalogsRoute, DuctFiles } from "./ducts-files.ts";
import { DuctsReadings, ductsReadings } from "./ducts-readings.ts";
import { runPods } from "./family-actions.ts";
import { httpProblems, isDoorFailure } from "./http-problems.ts";
import { InvalidRead } from "./native-reads.ts";
import { hostNativeReadFor } from "./native-recording.ts";
import {
  createPeRoutes,
  peCoreRoutes,
  type HostWork,
  type PeInvocationFactory,
} from "./pe-routes.ts";
import { productRouteWorkPath } from "./product-paths.ts";
import { RequestIdentity } from "./request-services.ts";
import { markReadings } from "./resource-adapters.ts";
import { fileRouteDocumentStore } from "./route-document-store.ts";
import { HostSessionInventory } from "./session-inventory.ts";
import { staticSpaLayer } from "./static-spa.ts";

import { guardedNativeRead, liveNativeRecipe } from "./native-read-root.ts";
const recordingCoverage = Effect.fail(
  new InvalidRead({
    message: "Recording does not cover this owner",
    status: 409,
    problem: "recording.coverage",
  }),
);
export const historicalRoutes = (inputs: HostInputContext["Service"], webRoot: string | null) =>
  Layer.mergeAll(readCoreRoutes(inputs), staticSpaLayer(webRoot, recordingCoverage)).pipe(
    Layer.provide(httpProblems),
  );

/** One host input HTTP/Work graph; live uses the bridge-subscribed retained owner, replay builds no live port. */
export const makeReadOwner = Effect.fn("Reads.compose")(function* (
  inputs: HostInputContext["Service"],
  options: {
    readonly live?: {
      owner: DuctsReadings;
      native: Layer.Layer<HostNativeRead>;
      files: Layer.Layer<DuctFiles>;
      marks: Layer.Layer<HostDocumentMarks>;
      inventory: Layer.Layer<HostSessionInventory>;
    };
    readonly store?: import("@pe/runtime").RouteDocumentStore;
    readonly observed?: TakingObserver;
    readonly observedReadSet?: (
      recipe: ConsumerRecipe,
      id: ReadSetId,
      requestId: string | undefined,
      caller: import("@pe/agent-contracts").Caller | undefined,
    ) => void;
    readonly initialize?: (workspace: RouteWorkspace) => Promise<void>;
    readonly registrations?: HostWork["registrations"];
    readonly pointers?: HostWork["pointers"];
  } = {},
) {
  const runtime = yield* Effect.context<never>();
  const lane = inputs.lane;
  if (lane.kind === "fixture") return yield* Effect.die(Error("A fixture has no host input graph"));
  const basis = createDuctsBodyBasis(lane, options.observed);
  const recorded = lane.kind === "recording";
  const live = recorded ? undefined : options.live;
  if (!recorded && (!live || !options.store))
    return yield* Effect.die(Error("Live input graph needs its real live inputs and Work store"));
  const writer = lane.kind === "live" ? lane.captureStore : undefined;
  const takeoffs = yield* Effect.serviceOption(CaptureStore);
  const pictureService = yield* Effect.serviceOption(PictureCaptureStore);
  const pictures = recorded
    ? undefined
    : Option.isSome(pictureService)
      ? pictureService.value
      : yield* PictureCaptureStore.pipe(Effect.provide(PictureCaptureStore.layer()));
  const services = yield* Layer.build(
    Layer.mergeAll(
      HostInputReadSets.layer(lane),
      guardedNativeRead().pipe(
        Layer.provide(
          hostNativeReadFor(
            lane,
            recorded
              ? liveNativeRecipe
              : nativeOutputLayer(pictures!).pipe(Layer.provide(live!.native)),
            basis?.observed,
          ),
        ),
        Layer.provide(Layer.succeed(HostInputContext, inputs)),
      ),
      recorded
        ? DuctFiles.recorded(lane.recordingStore)
        : writer
          ? DuctFiles.capturing(writer, options.observed).pipe(Layer.provide(live!.files))
          : live!.files,
      recorded
        ? HostDocumentMarks.recorded(lane.recordingStore)
        : writer
          ? HostDocumentMarks.capturing(writer, options.observed).pipe(Layer.provide(live!.marks))
          : live!.marks,
      recorded
        ? HostSessionInventory.recorded(lane.recordingStore)
        : writer
          ? HostSessionInventory.capturing(writer, options.observed).pipe(
              Layer.provide(live!.inventory),
            )
          : live!.inventory,
    ),
  );
  const provided = Context.merge(runtime, services);
  const run = <A, E>(effect: Effect.Effect<A, E>) => runPods({}, Effect.provide(effect, provided));
  const registrations = options.registrations ?? createRouteRegistrations();
  const workspace = new RouteWorkspace({
    registrations: constructorWorkRegistrations(registrations),
    ...(recorded
      ? { recorded: recordedWorkSource(lane.recordingStore) }
      : {
          store: options.store!,
          ...(writer ? { capture: capturedWorkReads(writer, run, options.observed) } : {}),
        }),
    authorizeMutation: (verb) => {
      const refusal = inputs.check({ kind: "work", verb });
      if (refusal) throw refusal;
    },
  });
  yield* Layer.build(admittedBuiltinsLayer(workspace, undefined, registrations));
  if (!recorded && options.initialize) yield* Effect.promise(() => options.initialize!(workspace));
  const owner = recorded ? new DuctsReadings() : live!.owner;
  const files = Context.get(services, DuctFiles),
    marks = Context.get(services, HostDocumentMarks);
  const readSets = Context.get(services, HostInputReadSets);
  const publications = new Publications();
  const history = writer
    ? new History(writer, run, writer, publications)
    : recorded
      ? new History(lane.recordingStore, run)
      : undefined;
  if (history) {
    // Optional: the recording lane's inputs are built before host-program opens the journal.
    const journal = yield* Effect.serviceOption(ActionJournalService);
    const stop = Option.isSome(journal)
      ? journal.value.subscribe({ kinds: ["action"] }, (receipt) => {
          if (receipt.body.kind !== "action") return;
          const row = receipt.body.value;
          if (
            row.state === "succeeded" &&
            row.target.kind === "document" &&
            row.steps.some(
              (s) => s.state === "succeeded" && s.effect !== "Read" && s.effect !== "TransactRead",
            )
          )
            history.afterWrite(row.target.ref, row.id);
        })
      : () => {};
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        stop();
        await history.close();
      }),
    );
  }
  const invalidations = readInvalidations(
    workspace,
    marks,
    recorded,
    publications,
    files.subscribe,
  );
  yield* Effect.addFinalizer(() => Effect.sync(invalidations.close));
  const json = (value: unknown) =>
    Schema.decodeUnknownSync(Schema.Json)(JSON.parse(JSON.stringify(value)));
  const assetInput = (sha: string) => ({ kind: "files" as const, file: `capture:${sha}` });
  const asset = (sha: string, owned = false) => {
    if (!/^[0-9a-f]{64}$/.test(sha)) throw Error("Invalid capture hash");
    const input = assetInput(sha);
    const read: Effect.Effect<string, import("@pe/host-internal/request-contracts").DoorFailure> =
      recorded
        ? replayInput(
            lane.recordingStore,
            input,
            "{}",
            Schema.String,
            owned ? undefined : lane.recordingStore.candidates(canonicalJson(input)).find((t) => t.scope === "{}")?.id,
          )
        : (() => {
            const value = Effect.tryPromise({
              try: async () => {
                const bytes = await pictures!.blob(sha);
                if (!bytes || createHash("sha256").update(bytes).digest("hex") !== sha)
                  throw Error(`Capture ${sha} has no valid retained PNG`);
                return bytes.toString("base64");
              },
              catch: (error) =>
                new InvalidRead({
                  message: String(error),
                  status: 404,
                  problem: "capture.missing",
                }),
            });
            return writer
              ? captureInput(writer, input, "{}", Schema.String, value, options.observed)
              : value;
          })();
    return read.pipe(
      Effect.map((encoded) => {
        const bytes = Buffer.from(encoded, "base64");
        if (createHash("sha256").update(bytes).digest("hex") !== sha)
          throw Error("Recorded capture bytes do not match their address");
        return bytes;
      }),
    );
  };
  const child = (parent: InputConsumption, recipe: ConsumerRecipe) => {
    const next = parent.child(recipe);
    if (Result.isFailure(next)) throw next.failure;
    return next.success;
  };
  const sealed = (current: InputConsumption) =>
    current.seal.pipe(
      Effect.tap(() =>
        Effect.gen(function* () {
          const request = yield* Effect.serviceOption(RequestIdentity);
          if (writer && !writer.capture.truncated())
            yield* Effect.try(() =>
              options.observedReadSet?.(
                current.recipe,
                current.id,
                Option.isSome(request) ? request.value.requestId : undefined,
                Option.isSome(request) ? request.value.caller : undefined,
              ),
            ).pipe(
              Effect.catch(() => {
                const at = writer.capture.begin();
                return at === null ? Effect.void : writer.capture.stop(at, "observer", { site: "builtin", op: current.recipe.key });
              }),
            );
        }),
      ),
    );
  const retained = (
    current: InputConsumption,
    input: NativeReadInput,
    readOptions: { version?: string; refresh?: string },
    role: "acquire" | "validate" | "join" | "beyond" | "none",
    document: HostSessionInventory["Service"]["document"],
  ) =>
    Effect.gen(function* () {
      const nested = yield* Effect.try({
        try: () =>
          child(current, {
            key: "ducts.retained",
            input: json({
              key: input.key,
              request: input.input,
              expectedVersion: readOptions.version ?? null,
              role,
            }),
            scope: canonicalJson(input.scope),
          }),
        catch: (error) =>
          isDoorFailure(error)
            ? error
            : new InvalidRead({
                message: String(error),
                status: 409,
                problem: "recording.context",
              }),
      });
      return yield* retainedDuctsRead(owner, input, readOptions, { document, basis }).pipe(
        Effect.onExit(() => sealed(nested)),
        Effect.ensuring(nested.close),
        Effect.provideService(CurrentInputConsumption, nested),
      );
    });
  const invocation: PeInvocationFactory = async (request, web, fallback) => {
    const identity = Context.get(request, RequestIdentity);
    const connectionOwner = Option.getOrNull(Context.getOption(request, ResourceConnectionOwner));
    const admitted = Context.add(provided, RequestIdentity, identity);
    const invoke = <A, E>(effect: Effect.Effect<A, E, RequestIdentityKey | HostNativeRead>) =>
      runPods({}, Effect.provide(effect, admitted));
    const url = new URL(web.url),
      declared = matchPeRoute(web.method, url.pathname)!;
    if (declared.id === "resources.subscriptions") return { resourceOwner: connectionOwner };
    if (![...graphRouteIds, "work.get", "ducts.analysis", "resources.stream"].includes(declared.id)) return {};
    const stream = declared.id === "resources.stream";
    const input = declared.route.input.parse({
      params: declared.params,
      query: Object.fromEntries(url.searchParams),
      body: web.method === "GET" ? undefined : await web.clone().json(),
    });
    const graph = graphRouteIds.includes(declared.id) ? graphRoute(declared.id, input.body) : null;
    const graphRequest = graph?.publication;
    const historyDocument = documentRefSchema.safeParse(
      (graph?.args as { target?: unknown } | undefined)?.target,
    );
    const at = web.headers.get("x-pe-history-point");
    if (at && web.headers.get("x-pe-history-compare") !== "now" && graph) {
      return {
        readGraph: async () => {
          localHistory(identity.caller);
          if (!graphRequest)
            throw new InvalidRead({
              message: "This read was never published at this point",
              status: 409,
              problem: "history.unavailable",
            });
          if (graphRequest.release)
            return {
              key: "",
              generation: graphRequest.generation,
              version: 0,
              value: null,
              state: "superseded",
            };
          if (!history)
            throw new InvalidRead({
              message: "History storage is unavailable",
              status: 409,
              problem: "history.unavailable",
            });
          const pose = historyPoseSchema.parse(
            JSON.parse(decodeURIComponent(web.headers.get("x-pe-history-page") ?? "")),
          );
          const raw = await history.publication(at, pose.instance, graph.name, graph.key);
          return { ...(raw as object), generation: graphRequest.generation };
        },
      };
    }
    if (graphRequest?.release)
      return {
        readGraph: async () => {
          publications.release(
            canonicalJson([identity.caller, graphRequest.subscription]),
            graphRequest.generation,
          );
          return {
            key: "",
            generation: graphRequest.generation,
            version: 0,
            value: null,
            state: "superseded",
          };
        },
      };
    const admission = graphRequest ? publications.admission(
      canonicalJson([identity.caller, graphRequest.subscription]), graphRequest.generation,
    ) : undefined;
    try {
    const recipe: ConsumerRecipe = {
      key: declared.id,
      input: json(graph ? { body: { read: graph.name, args: graph.args } } : input),
      scope: canonicalJson(json(identity.scope)),
    };
    // Transport registration consumes no recording; POST-added keys admit their own frames.
    const consumption =
      recorded && stream
        ? undefined
        : await invoke(readSets.open(recipe, (graph?.readSet as ReadSetId) ?? null));
    const scoped =
      (current: InputConsumption): WorkInputRunner =>
      (effect) =>
        runPods(
          {},
          Effect.provide(effect, Context.add(admitted, CurrentInputConsumption, current)),
        );
    const complete = (current: InputConsumption) => scoped(current)(sealed(current));
    const activeFrames = new Map<InputConsumption, symbol>();
    let closingResources = false;
    const closeResources = () => {
      if (consumption && closingResources && !activeFrames.size) void invoke(consumption.close);
    };
    const finishFrame = async (current: InputConsumption) => {
      try {
        await invoke(current.close);
      } finally {
        activeFrames.delete(current);
        closeResources();
      }
    };
    const inventory = Context.get(services, HostSessionInventory);
    // Every host-only input starts a taking in the same evaluation as native and Work inputs.
    const takeOwner = (
      current: InputConsumption,
      input: RecordedInput,
      live: () => Promise<unknown>,
    ) => {
      const scope = "{}";
      const codec = Schema.Json;
      const effect = recorded
        ? replayInput(lane.recordingStore, input, scope, codec)
        : (() => {
            const value = Effect.tryPromise({
              try: async () => json(await live()),
              catch: (error) =>
                new InvalidRead({ message: String(error), status: 409, problem: "input.failed" }),
            });
            return writer
              ? captureInput(writer, input, scope, codec, value, options.observed)
              : value;
          })();
      return scoped(current)(effect);
    };
    const takeFile = (name: string, args: unknown, current: InputConsumption) =>
      takeOwner(current, { kind: "files", file: canonicalJson([name, json(args)]) }, () =>
        name === "takeoff-capture"
          ? (async () => {
              if (Option.isNone(takeoffs)) throw Error("Takeoff capture store is unavailable");
              const { target, snapshot: body, views } = takeoffSnapshotInput.parse(args);
              const row = await invoke(inventory.document(target));
              if (!row.address || !sameAddress(row.address, addressSchema.parse(body.reading.at))) throw Error("Snapshot returned a different document");
              const sessions = await invoke(inventory.list());
              const title = sessions.sessions.find(session => session.sessionId === target.session)?.openDocuments?.find(doc => doc.openId === target.openId)?.title;
              if (!title) throw Error("Snapshot document is no longer open");
              return takeoffs.value.retain(projectTakeoffSnapshot(body, title, views), { kind: "live", target },
                async () => { const current = await invoke(inventory.document(target));
                  if (!current.address || !sameAddress(current.address, row.address!)) throw Error("Snapshot target changed before retention"); });
            })()
          : name.startsWith("local:")
          ? readLocal(name.slice(6), args)
          : name === "family-spec"
            ? readFamilySpec(args)
            : Promise.reject(Error(`Unknown file input ${name}`)),
      );
    const sources = (current: InputConsumption): ReadSources => {
      const context = Context.add(admitted, CurrentInputConsumption, current);
      const invoke = <A, E>(effect: Effect.Effect<A, E, RequestIdentityKey | HostNativeRead>) =>
        runPods({}, Effect.provide(effect, context));
      const documents = new Map<string, ReturnType<typeof inventory.document>>();
      const documentRead: typeof inventory.document = (ref) =>
        Effect.gen(function* () {
          const key = JSON.stringify(ref);
          let read = documents.get(key);
          if (!read) {
            read = yield* Effect.cached(inventory.document(ref));
            documents.set(key, read);
          }
          return yield* read;
        });
      const document = (ref: import("@pe/agent-contracts").DocumentRef) =>
        invoke(documentRead(ref));
      return {
        file: (name, args) =>
          name === "firm"
            ? invoke(files.firm(String(args)))
            : name === "catalogs"
              ? invoke(files.ductCatalogs)
              : name === "capture"
                ? scoped(current)(asset(String(args), true)).then(() => String(args))
                : takeFile(name, args, current),
        workKey: async (ref) => bindWork("ducts", (await document(ref)).address, undefined, ref),
        inputs: {
          consumption: current,
          run: scoped(current),
          work: workReadContext(current, scoped(current)),
        },
        resource: (request) =>
          // The session inventory is no resource adapter's (`fallback` refuses it). A graph read takes
          // it from the owner the stream door uses (`retainedResource`), as that owner's own taking:
          // inside `takeOwner` it would be one taking nested in another on the same consumption.
          (request as { kind: string }).kind === "inventory"
            ? invoke(inventory.list())
            : takeOwner(
            current,
            { kind: "resource", key: "snapshot", args: canonicalJson(json(request)) },
            () => {
              if ((request as { kind: string }).kind === "captures")
                return (async () => {
                  const captures = await pictures!.list();
                  return { captures };
                })();
              const resource = readingRequestSchema.parse(request);
              if (resource.kind === "takeoff-saved") return (async () => {
                if (Option.isNone(takeoffs)) throw Error("Takeoff capture store is unavailable");
                if (resource.id) return resource.text ? takeoffs.value.savedText(resource.id) : takeoffs.value.saved(resource.id);
                return (await takeoffs.value.list(resource.document ? addressSchema.parse(resource.document) : undefined))
                  .map(({ snapshot, ...capture }) => ({ ...capture, document: snapshot.reading.at, title: snapshot.world.docName }));
              })();
              return new Promise((resolve, reject) => {
                let settled = false,
                  stop = () => {};
                stop = fallback(
                  request as Parameters<ResourceObserver>[0],
                  (frame) => {
                    if (frame.kind === "snapshot") {
                      settled = true;
                      resolve(frame.value);
                      stop();
                    } else if (frame.kind === "failure") {
                      settled = true;
                      reject(Error(frame.error));
                      stop();
                    }
                  },
                  0,
                );
                if (settled) stop();
              });
            },
          ),
        call: async (key, input, target, version, role) => {
          const chosen = executionTargetSchema.parse(target);
          const safety = hostOpSafety[key as keyof typeof hostOpSafety];
          if (!safety || safety.intent !== "Read")
            throw Error(`Native leaf is not a catalog Read: ${key}`);
          const ref = chosen.kind === "document" ? chosen.ref : null;
          if (!["ducts.snapshot.roster", "ducts.snapshot.walk", "ducts.tables"].includes(key)) {
            const native = Context.get(services, HostNativeRead);
            const scope = ref
              ? { bridgeSessionId: ref.session, openDocumentId: ref.openId }
              : chosen.kind === "session"
                ? { bridgeSessionId: chosen.session }
                : {};
            const answer = await invoke(native.read({ key, input, scope }));
            return new Response(JSON.stringify(answer.value), {
              // Admission generations fence native flights; sealed read versions describe content.
              // Keep freshness evidence in the native taking, outside the Value's content identity.
              headers: { [NATIVE_BODY_VERSION_HEADER]: fingerprint(answer.value) },
            });
          }
          if (!ref) throw Error("Retained document read requires a document target");
          const scope = {
            bridgeSessionId: ref.session,
            ...(key === "ducts.tables" ? {} : { openDocumentId: ref.openId }),
          };
          return HttpServerResponse.toWeb(
            await invoke(retained(current, { key, input, scope }, { version }, role, documentRead)),
          );
        },
      };
    };
    const observeFrame = (
      reading: Parameters<ResourceObserver>[0],
      publish: Parameters<ResourceObserver>[1],
      after: Parameters<ResourceObserver>[2],
      recordedFrame?: InputConsumption,
    ) => {
      if (
        !recorded &&
        !["work", "work-acks", "ducts-snapshot", "ducts-tables", "inventory"].includes(reading.kind)
      )
        return fallback(reading, publish, after);
      class FrameCarriage extends WorkCarriage {
        constructor(
          readonly subscription?: ReadSetId,
          readonly envelope?: DuctsReadingEnvelope,
        ) {
          super();
        }
      }
      const frameRuns = new WeakMap<WorkCarriage, WorkInputRunner>();
      const readyFrames = new Set<InputConsumption>();
      const frameOwner = Symbol();
      let released = false;
      const frameRecipe: ConsumerRecipe = {
        key: "resource.frame",
        input: json(reading),
        scope: recipe.scope,
      };
      const frame = (recipe = frameRecipe) => {
        const current = recordedFrame ?? child(consumption!, recipe);
        activeFrames.set(current, frameOwner);
        return current;
      };
      const work: WorkReadContext = {
        begin: (read) => {
          try {
            const current = frame();
            const run: WorkInputRunner = (effect) =>
              scoped(current)(effect).finally(() => {
                if (released) return finishFrame(current);
                readyFrames.add(current);
              });
            const begun = workReadContext(current, run).begin(read);
            if (begun.ok && begun.carriage) frameRuns.set(begun.carriage, scoped(current));
            else void finishFrame(current);
            return begun;
          } catch (error) {
            return { ok: false, error };
          }
        },
      };
      const retainedResource: ResourceObserver = (reading, publish) => {
        let closed = false,
          release = () => {};
        const key = readingKey(reading);
        if (reading.kind === "inventory") {
          let subscription: ReadSetId | undefined;
          const read = async () => {
            const current = subscription ? await invoke(readSets.open(frameRecipe, null)) : frame();
            activeFrames.set(current, frameOwner);
            try {
              if (subscription)
                await scoped(current)(current.linkReadSet("subscription", subscription));
              const result = await scoped(current)(
                Effect.provideService(Effect.result(inventory.list()), RequestIdentity, identity),
              );
              if (!released) {
                await complete(current);
                subscription ??= current.id;
              }
              return result;
            } finally {
              await finishFrame(current);
            }
          };
          const fail = (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            if (!released)
              publish({
                kind: "failure",
                key,
                error: message,
                failure: {
                  kind: "failed",
                  code: isDoorFailure(error) ? error.problem : "ReadingFailed",
                  message,
                },
              });
          };
          const accept = (
            result: import("@pe/runtime").OwnerValue<Awaited<ReturnType<typeof read>>>,
          ) => {
            if (released) return;
            if ("error" in result) {
              fail(Error(result.error));
              return;
            }
            if (Result.isFailure(result.value)) fail(result.value.failure);
            else publish(resourceSnapshot(key, { value: result.value.success }));
          };
          if (recorded) {
            void read()
              .then((value) => accept({ value }))
              .catch(fail);
            return () => {};
          }
          // ADR0029 shared native dispatch does not share metadata consumers: each keeps its own context.
          return new OwnerReads().observe(key, read, inventory.subscribe, accept);
        }
        if (reading.kind !== "ducts-snapshot" && reading.kind !== "ducts-tables") {
          publish({
            kind: "failure",
            key,
            error: "Recording does not cover this reading owner",
            failure: {
              kind: "failed",
              code: "recording.coverage",
              message: "Recording does not cover this reading owner",
            },
          });
          return () => {};
        }
        const input =
          reading.kind === "ducts-snapshot"
            ? (() => {
                const { kind, target, ...args } = reading;
                return {
                  key:
                    reading.selector.kind === "roster"
                      ? "ducts.snapshot.roster"
                      : "ducts.snapshot.walk",
                  input: args,
                  scope: { bridgeSessionId: target.session, openDocumentId: target.openId },
                };
              })()
            : (() => {
                const { kind, session, ...args } = reading;
                return { key: "ducts.tables", input: args, scope: { bridgeSessionId: session } };
              })();
        const current = frame();
        void invoke(retained(current, input, {}, "acquire", inventory.document))
          .then(async (response) => {
            await HttpServerResponse.toWeb(response).body?.cancel();
            if (closed) {
              await finishFrame(current);
              return;
            }
            readyFrames.add(current);
            let first = true;
            if (!closed)
              release = owner.observe(reading, (value) => {
                try {
                  // A notification observes an envelope, not another taking of the acquired native body.
                  const carriage = new FrameCarriage(first ? undefined : current.id, value);
                  first = false;
                  frameRuns.set(carriage, scoped(current));
                  publish(resourceSnapshot(key, { value }), carriage);
                } catch (error) {
                  const failure = error as InvalidRead;
                  publish({
                    kind: "failure",
                    key,
                    error: failure.message,
                    failure: {
                      kind: "failed",
                      code: failure.problem ?? "ReadingFailed",
                      message: failure.message,
                    },
                  });
                }
              });
          })
          .catch(async (error) => {
            await finishFrame(current);
            if (!closed)
              publish({
                kind: "failure",
                key,
                error: error.message,
                failure: {
                  kind: "failed",
                  code: error.problem ?? "ReadingFailed",
                  message: error.message,
                },
              });
          });
        return () => {
          closed = true;
          release();
        };
      };
      const release = markReadings(marks, async (ref, key, at, carriage, update) => {
        const runFrame = carriage ? frameRuns.get(carriage) : undefined;
        if (!runFrame) {
          if (!ref) return null;
          if (!recorded && (!writer || writer.capture.truncated()))
            return invoke(marks.readFrame(ref, key, at));
          throw new InvalidRead({
            message: "Resource frame lost its consumption context",
            status: 409,
            problem: "recording.context",
          });
        }
        return runFrame(
          Effect.gen(function* () {
            const active = yield* Effect.serviceOption(CurrentInputConsumption);
            if (Option.isNone(active))
              return yield* new InvalidRead({
                message: "Frame runner has no consumption",
                status: 409,
                problem: "recording.context",
              });
            const previous = active.value;
            const independent =
              !recorded &&
              (update || (carriage instanceof FrameCarriage && !!carriage.subscription));
            const current = independent
              ? yield* readSets.open(
                  carriage instanceof FrameCarriage && carriage.envelope
                    ? {
                        ...frameRecipe,
                        key: "resource.notification",
                        input: json({ reading, envelope: carriage.envelope }),
                      }
                    : previous.recipe,
                  null,
                )
              : previous;
            if (independent) activeFrames.set(current, frameOwner);
            readyFrames.delete(current);
            if (!update && carriage) frameRuns.set(carriage, scoped(current));
            return yield* Effect.tryPromise({
              try: async () => {
                try {
                  if (released)
                    throw new InvalidRead({
                      message: "Resource subscription is closed",
                      status: 409,
                      problem: "recording.context",
                    });
                  if (update) await scoped(current)(current.linkReadSet("value", previous.id));
                  else if (carriage instanceof FrameCarriage && carriage.subscription)
                    await scoped(current)(
                      current.linkReadSet("subscription", carriage.subscription),
                    );
                  if (ref && writer && !writer.capture.truncated())
                    await scoped(current)(
                      inventory.document(ref).pipe(
                        Effect.provideService(RequestIdentity, identity),
                        Effect.catch(() => {
                          const at = writer.capture.begin();
                          return at === null ? Effect.void : writer.capture.stop(at, "unsupported", { site: "builtin", op: "inventory.document" });
                        }),
                      ),
                    );
                  const value = ref ? await scoped(current)(marks.readFrame(ref, key, at)) : null;
                  if (!released) await complete(current);
                  return value;
                } finally {
                  await finishFrame(current);
                }
              },
              catch: (error) =>
                isDoorFailure(error)
                  ? error
                  : new InvalidRead({
                      message: String(error),
                      status: 409,
                      problem: "recording.context",
                    }),
            });
          }),
        );
      })(observeResources(workspace, undefined, retainedResource, work))(reading, publish, after);
      return () => {
        released = true;
        release();
        for (const current of readyFrames) void finishFrame(current);
        readyFrames.clear();
        if (writer?.capture.truncated())
          for (const [current, owner] of activeFrames)
            if (owner === frameOwner) void finishFrame(current);
      };
    };
    const observe: ResourceObserver = (reading, publish, after) => {
      // A read publication's invalidation rides the tab's one stream (HTTP/1.1 gives an origin 6
      // sockets; a stream per read starved the rest). Metadata only, per caller: the value travels
      // once in the read response. It is answered before the lanes part, so it opens no read set
      // and consumes no recording, as the retired /pe/read-events did not.
      if (reading.kind === "publication") {
        const key = readingKey(reading);
        const { generation } = reading;
        let answered = false;
        const stop = publications.observe(
          canonicalJson([identity.caller, reading.subscription]),
          (publication) => {
            if (publication.generation !== generation) return;
            answered = true;
            publish({
              kind: "snapshot",
              key,
              value: { generation, version: publication.version, state: publication.state },
            });
          },
        );
        // Every key is answered once, so a stream that carries only this key is never silent.
        if (!answered)
          publish({ kind: "snapshot", key, value: { generation, version: 0, state: "absent" } });
        return stop;
      }
      if (!recorded) return observeFrame(reading, publish, after);
      let released = false,
        release = () => {};
      void invoke(
        readSets.open({ key: "resource.frame", input: json(reading), scope: recipe.scope }, null),
      )
        .then(async (current) => {
          if (released) {
            await invoke(current.close);
            return;
          }
          try {
            const stop = observeFrame(
              reading,
              (frame, carriage) => {
                if (frame.kind !== "failure") {
                  publish(frame, carriage);
                  return;
                }
                void finishFrame(current).then(() => {
                  if (!released) publish(frame, carriage);
                });
              },
              after,
              current,
            );
            release = () => {
              stop();
              void finishFrame(current);
            };
          } catch (error) {
            await finishFrame(current);
            throw error;
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (!released)
            publish({
              kind: "failure",
              key: readingKey(reading),
              error: message,
              failure: {
                kind: "failed",
                code: isDoorFailure(error) ? error.problem : "ReadingFailed",
                message,
              },
            });
        });
      return () => {
        released = true;
        release();
      };
    };
    const source = consumption ? sources(consumption) : undefined;
    return {
      ...(graph && source
        ? {
            readGraph: async () => {
              const port = inputPort({
                leaves: registeredReads.leaves,
                source,
                workspace,
                marks,
                run: scoped(consumption!),
                evaluation: consumption!.id,
                origin: () => inputs.source,
                revision: invalidations.revision,
              });
              return graph.publication
                ? graph.publish(
                    publications,
                    canonicalJson([identity.caller, graph.publication.subscription]),
                    graph.publication.generation,
                    port,
                    history && writer && historyDocument.success
                      ? async (publication) => {
                          // Live inventory and seal stay awaited outside History.record (fail closed); only keep/append may fail open (K4).
                          const row = await scoped(consumption!)(
                            inventory
                              .document(historyDocument.data)
                              .pipe(Effect.provideService(RequestIdentity, identity)),
                          );
                          const address = addressSchema.parse(row.address);
                          await complete(consumption!);
                          const raw = web.headers.get("x-pe-history-page");
                          const pose = raw
                            ? historyPoseSchema.parse(JSON.parse(decodeURIComponent(raw)))
                            : {
                                instance: graph.name,
                                route: graph.name.split(".")[0]!,
                                page: {},
                                href: `/${graph.name.split(".")[0]}`,
                              };
                          return history.record(
                            canonicalJson([identity.caller, graph.publication!.subscription]),
                            graph.name,
                            pose,
                            address,
                            row,
                            publication,
                          );
                        }
                      : undefined,
                    admission,
                  )
                : graph.evaluate(port).catch((error: unknown) => {
                    if (isDoorFailure(error)) throw error;
                    throw new InvalidRead({
                      message: error instanceof Error ? error.message : String(error),
                      status: 409,
                      problem: "read.refresh-needed",
                    });
                  });
            },
          }
        : {}),
      ...(source && {
        work: source.inputs!.work,
        document: (ref: import("@pe/agent-contracts").DocumentRef) =>
          runPods(
            {},
            Effect.provide(
              inventory.document(ref),
              Context.add(admitted, CurrentInputConsumption, consumption!),
            ),
          ),
      }),
      observe,
      closeResources: () => {
        closingResources = true;
        closeResources();
      },
      resourceOwner: connectionOwner,
      finish: async (result) => {
        if (stream) {
          if (consumption && ("error" in result || !result.response.ok))
            await invoke(consumption.close);
          return;
        }
        try {
          if ("response" in result && result.response.ok) {
            if (!graph?.publication || !history || !writer || !historyDocument.success)
              await complete(consumption!);
          }
        } catch {
          const at = writer?.capture.begin();
          if (at != null) await invoke(writer!.capture.stop(at, "io", { site: "builtin", op: consumption?.recipe.key ?? "read.finish" }));
        } finally {
          admission?.close();
          if (consumption) await invoke(consumption.close);
        }
      },
    };
    } catch (error) {
      admission?.close();
      throw error;
    }
  };
  const retainedCall = (
    raw: NativeReadInput,
    readOptions: { version?: string; refresh?: string },
  ) =>
    Effect.gen(function* () {
      raw = { ...raw, scope: JSON.parse(JSON.stringify(raw.scope)) };
      const missing = inputs.check({ kind: "input", input: "document" });
      if (missing) return yield* missing;
      const inventory = Context.get(services, HostSessionInventory);
      const root = yield* readSets.open(
        {
          key: "native.call",
          input: json({
            ...raw,
            version: readOptions.version ?? null,
            refresh: readOptions.refresh ?? null,
          }),
          scope: canonicalJson(raw.scope),
        },
        null,
      );
      return yield* Effect.gen(function* () {
        const selected = raw.scope.bridgeSessionId
          ? {
              ...raw.scope,
              bridgeSessionId: (yield* inventory.attachment(raw.scope.bridgeSessionId)).sessionId,
            }
          : raw.scope;
        const session = yield* inventory.session(selected);
        const { openDocumentId, ...scope } = selected;
        const response = yield* retained(
          root,
          {
            ...raw,
            scope: {
              ...scope,
              bridgeSessionId: session.sessionId,
              ...(raw.key === "ducts.tables" ? {} : { openDocumentId }),
            },
          },
          readOptions,
          "acquire",
          inventory.document,
        );
        if (writer && !writer.capture.truncated() && openDocumentId && raw.key !== "ducts.tables")
          yield* inventory.document({ session: session.sessionId, openId: openDocumentId }).pipe(
            Effect.catch(() => {
              const at = writer.capture.begin();
              return at === null ? Effect.void : writer.capture.stop(at, "unsupported", { site: "builtin", op: "inventory.document" });
            }),
          );
        return response;
      }).pipe(
        Effect.tap(() => sealed(root)),
        Effect.ensuring(root.close),
        Effect.provideService(CurrentInputConsumption, root),
        Effect.provideService(HostNativeRead, Context.get(services, HostNativeRead)),
      );
    });
  const commandRead = async <A>(
    admission: import("@pe/agent-contracts").ActionAdmission,
    method: "read" | "view",
    key: import("@pe/agent-contracts").WorkKey,
    route: string,
    read: (context: import("@pe/runtime").WorkReadContext) => Promise<A>,
  ) => {
    const current = await run(
      readSets.open(
        {
          key: `command.work.${method}`,
          input: json({ id: admission.id, command: admission.key, key, route }),
          scope: canonicalJson(admission.target),
        },
        null,
      ),
    );
    const scoped: WorkInputRunner = (effect) =>
      run(Effect.provideService(effect, CurrentInputConsumption, current));
    try {
      const value = await read(workReadContext(current, scoped));
      if (writer && !writer.capture.truncated()) await scoped(sealed(current));
      return value;
    } finally {
      await run(current.close);
    }
  };
  const commandReads: NonNullable<import("./command-executor.ts").CommandResources["workReads"]> = (
    admission,
  ) => ({
    read: (key, route) =>
      commandRead(admission, "read", key, route, (context) => workspace.read(key, route, context)),
    view: (key, route) =>
      commandRead(admission, "view", key, route, (context) => workspace.view(key, route, context)),
  });
  const work = { workspace, registrations, pointers: options.pointers, reads: commandReads };
  const nativeCall = Effect.fn("Reads.nativeBody")(function* (raw: NativeReadInput) {
    const { answer } = yield* nativeBody(raw, Context.get(services, HostNativeRead).read(raw));
    return HttpServerResponse.jsonUnsafe(answer.value, {
      headers: { "x-pe-native-request-id": answer.nativeRequestId },
    });
  });
  const nativeBody = Effect.fn("Reads.nativeBodyCapture")(function* (
    raw: NativeReadInput,
    read: Effect.Effect<
      import("@pe/host-internal/request-contracts").NativeAnswer<Schema.Json>,
      import("@pe/host-internal/request-contracts").DoorFailure,
      RequestIdentityKey | HostNativeRead
    >,
  ) {
    yield* admitNativeCaller(raw.key);
    const takingId = lane.kind === "recording"
      ? lane.bindings?.get(yield* nativeInputIdentity(raw))
      : undefined;
    const root = yield* readSets.open(
      { key: "native.call", input: json(raw), scope: canonicalJson(raw.scope) },
      takingId === undefined ? null : { takingId },
    );
    return yield* Effect.gen(function* () {
      const answer = yield* read;
      if (writer && "openId" in answer.actualTarget.openDocumentLifetime) {
        const inventory = Context.get(services, HostSessionInventory);
        const openId = answer.actualTarget.openDocumentLifetime.openId;
        let op = "inventory.session";
        yield* Effect.gen(function* () {
          const session = yield* inventory.session(raw.scope);
          op = "inventory.document";
          yield* inventory.document({ session: session.sessionId, openId });
        }).pipe(
          Effect.catch(() => {
            const at = writer.capture.begin();
            return at === null ? Effect.void : writer.capture.stop(at, "unsupported", { site: "builtin", op });
          }),
        );
      }
      yield* sealed(root);
      return { answer };
    }).pipe(
      Effect.provideService(CurrentInputConsumption, root),
      Effect.provideService(HostNativeRead, Context.get(services, HostNativeRead)),
      Effect.ensuring(root.close),
    );
  });
  return {
    work,
    invocation,
    retainedCall,
    nativeCall,
    nativeBody,
    services,
    publications,
    history,
    asset,
  };
});

export type ReadOwnerOptions = NonNullable<Parameters<typeof makeReadOwner>[1]>;

export class ReadOwner extends Context.Service<
  ReadOwner,
  Effect.Success<ReturnType<typeof makeReadOwner>>
>()("pe/ReadOwner") {}

const readCoreRoutes = (
  inputs: HostInputContext["Service"],
  options: Parameters<typeof makeReadOwner>[1] = {},
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const reads = yield* makeReadOwner(inputs, options);
      const routes = createPeRoutes({
        inputs,
        workspace: reads.work.workspace,
        registrations: reads.work.registrations,
      });
      return Layer.mergeAll(
        inputs.lane.kind === "recording"
          ? HttpRouter.add("GET", "/captures/:asset", (req) => {
              const sha =
                new URL(req.url, "http://host").pathname
                  .split("/")
                  .at(-1)
                  ?.replace(/\.png$/, "") ?? "";
              return reads
                .asset(sha)
                .pipe(
                  Effect.map((bytes) =>
                    HttpServerResponse.uint8Array(bytes, { contentType: "image/png" }),
                  ),
                );
            })
          : Layer.empty,
        peCoreRoutes(routes, reads.invocation, inputs),
        historyRoutes(reads.history),
        nativeReadResolveRoute,
        nativeCallRouteFor(reads.retainedCall, reads.nativeCall),
      ).pipe(
        HttpRouter.provideRequest(
          Layer.succeedContext(Context.add(reads.services, HostInputContext, inputs)),
        ),
        Layer.provide(Layer.succeedContext(Context.add(reads.services, HostInputContext, inputs))),
      );
    }),
  );

export const readInputRoutes = (
  inputs: HostInputContext["Service"],
  options: Parameters<typeof makeReadOwner>[1] = {},
) =>
  Layer.mergeAll(
    readCoreRoutes(inputs, options),
    HttpRouter.add("*", "/*", () => recordingCoverage),
  ).pipe(Layer.provide(httpProblems));

/** Built-in domain registration lives here; the HTTP kernel composes this module without route knowledge. */
export const builtinFileLayer = () => DuctFiles.layer();
export const builtinFileRoutes = ductCatalogsRoute;
export const defaultReadOwner = (
  inputs: HostInputContext["Service"],
  options: Omit<ReadOwnerOptions, "live"> & {
    live?: Omit<NonNullable<ReadOwnerOptions["live"]>, "owner">;
  },
) =>
  Effect.gen(function* () {
    const live = options.live ?? {
      native: Layer.succeed(HostNativeRead, yield* HostNativeRead),
      files: Layer.succeed(DuctFiles, yield* DuctFiles),
      marks: Layer.succeed(HostDocumentMarks, yield* HostDocumentMarks),
      inventory: Layer.succeed(
        HostSessionInventory,
        yield* HostSessionInventory.pipe(Effect.provide(HostSessionInventory.layer)),
      ),
    };
    return yield* makeReadOwner(inputs, {
      ...options,
      store: options.store ?? fileRouteDocumentStore(productRouteWorkPath()),
      live: { ...live, owner: ductsReadings(yield* RevitBridge) },
    });
  });
