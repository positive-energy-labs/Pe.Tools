import { HostInputContext } from "../src/input-context.ts";
import { PictureCaptureStore } from "../src/captures-route.ts";
import { DuctFiles } from "../src/ducts-files.ts";
import { HostDocumentMarks } from "../src/document-marks.ts";
import { ActionJournalService, makeActionJournal } from "../src/receipt-services.ts";
import { makeCallRoute } from "../src/call-route.ts";
import * as adapter from "../src/harness/adapter.ts";
import { Spawner } from "../src/harness/spawner.ts";
import { NodeCrypto, NodeServices } from "@effect/platform-node";
import { FetchHttpClient } from "effect/http";
import { Cause, Context, Effect, Exit, Layer, Logger, References, Scope } from "effect";
import { TestClock } from "effect/testing";
import { onTestFinished, test, type TestContext } from "vite-plus/test";
import { FamiliesReader } from "../src/families-reader.ts";
import { RevitBridge, RevitBridgeDetached, type BridgeSessionView } from "../src/bridge.ts";
import type { BridgeStateSnapshot } from "@pe/host-contracts/contracts";
import { HarnessThreads, type HarnessThreadsOptions } from "../src/harness/threads.ts";
import { CaptureStore, type TakeoffCaptures } from "../src/takeoff-captures.ts";
import {
  MachineOwner,
  machineOwnerPromise,
  type MachineOptions,
  type MachineOwnerPromise,
  type MachineSources,
} from "../src/machine.ts";
import {
  RunConsents,
  runConsentsPromise,
  type ConsentSink,
  type RunConsentsPromise,
} from "../src/run-consent.ts";

const runRoot =
  <A, E>(body: () => Effect.Effect<A, E, Scope.Scope>) =>
  (context: TestContext) => {
    // The it.effect seam; @effect/vitest needs vitest 5.
    // effect-edge: test-runner
    const root = Effect.runFork(
      Effect.suspend(body).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
      { signal: context.signal },
    );
    // The runner owns the root: a timeout, a cancel or a failed assertion elsewhere interrupts it,
    // and the test does not finish until its scope's finalizers have run.
    context.onTestFinished(
      () =>
        new Promise<void>((resolve) => {
          root.interruptUnsafe();
          root.addObserver(() => resolve());
        }),
    );
    return new Promise<void>((resolve, reject) =>
      root.addObserver((exit) =>
        Exit.isSuccess(exit) ? resolve() : reject(Cause.squash(exit.cause)),
      ),
    );
  };

/**
 * `it.effect` for this repo: one root fiber per test under a `TestClock`, owned by the runner.
 * `@effect/vitest` 4.0.x peers on vitest 5 while vite-plus 0.2.1 runs vitest 4.1.9, so the runner
 * edge lives here until the toolchain moves; the shape matches `it.effect` so a later swap is a
 * rename.
 */
export const effectTest = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, Scope.Scope>,
  timeout?: number,
) => test(name, runRoot(body), timeout);
/** A test expected to fail (a deliberate timeout probe included). */
effectTest.fails = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, Scope.Scope>,
  timeout?: number,
) => test.fails(name, runRoot(body), timeout);

/** Log lines the effect under test wrote, as `message` plus annotations. */
export const captureLogs = () => {
  const lines: { message: unknown; annotations: Record<string, unknown> }[] = [];
  const layer = Logger.layer([
    Logger.make((options) => {
      lines.push({
        message: options.message,
        annotations: { ...options.fiber.getRef(References.CurrentLogAnnotations) },
      });
    }),
  ]);
  return { lines, layer };
};

/** Build `layer` in a scope the running test closes; a module fixture's scope lives with its worker. */
const testScoped = <S, E>(layer: Layer.Layer<S, E>) => {
  const scope = Scope.makeUnsafe();
  try {
    // effect-edge: test-runner
    onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  } catch {
    // Outside a running test: a module fixture, closed with its worker.
  }
  // effect-edge: test-runner
  return Effect.runSync(Layer.buildWithScope(layer, scope));
};

/**
 * {@link RunConsents} for Promise tests: the live layer, built in a scope the running test closes
 * (a module-level fixture's scope lives with its worker). Closing it interrupts open windows.
 */
export const consentService = (): RunConsents["Service"] => {
  return Context.get(testScoped(RunConsents.layer.pipe(Layer.provide(NodeCrypto.layer))), RunConsents);
};

/** {@link RevitBridgeDetached} as a value, built in a scope the running test closes. */
export const detachedBridge = (overrides?: Partial<RevitBridge["Service"]>) =>
  Context.get(testScoped(RevitBridgeDetached(overrides)), RevitBridge);

type DocumentView = BridgeStateSnapshot["openDocuments"][number];
const emptyState = {
  activeDocumentCloudModelGuid: null, activeDocumentCloudModelUrn: null, activeDocumentCloudProjectGuid: null,
  activeDocumentIsFamilyDocument: false, activeDocumentIsModelInCloud: false, activeDocumentIsWorkshared: false,
  activeDocumentKey: null, activeDocumentObservedAtUnixMs: 0, activeDocumentPath: null, activeDocumentTitle: null,
  documentIdentity: null, hasActiveDocument: false, revitVersion: "test", runtimeAssemblies: [],
  runtimeFramework: "test", sharedParametersFilename: null,
} satisfies Omit<BridgeStateSnapshot, "openDocuments">;
/** A session row for a `list` override; unnamed state is empty, documents unsaved and inactive. */
export const sessionView = ({ state, ...view }: Omit<BridgeSessionView, "state"> & {
  state?: Partial<Omit<BridgeStateSnapshot, "openDocuments">> & { openDocuments: readonly (Partial<DocumentView> & { openId: string })[] };
}): BridgeSessionView => ({
  ...view,
  state: {
    ...emptyState,
    ...state,
    openDocuments: (state?.openDocuments ?? []).map((document) => ({
      title: "", address: null, isFamilyDocument: false, isActive: false, ...document,
    })),
  },
});

/** The Promise face with a transcript sink attached; persist defaults to a no-op, auto-approve on. */
export const testConsents = (
  emit: ConsentSink["emit"],
  sink: Partial<Omit<ConsentSink, "emit">> = {},
): RunConsentsPromise => {
  const runs = runConsentsPromise(consentService());
  runs.attach({ emit, persist: () => {}, autoApprove: () => true, ...sink });
  return runs;
};

/**
 * {@link HarnessThreads} for Promise tests: the live layer over the node file system, built in a
 * scope the running test closes (which stops every harness child the store started). Building is
 * async because the replay is an Effect.
 */
export const harnessThreads = async (
  options: HarnessThreadsOptions,
): Promise<HarnessThreads["Service"]> => {
  const scope = Scope.makeUnsafe();
  try {
    // effect-edge: test-runner
    onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  } catch {
    // Outside a running test: a module fixture, closed with its worker.
  }
  // effect-edge: test-runner
  const context = await Effect.runPromise(
    Layer.buildWithScope(
      HarnessThreads.layer(options).pipe(
        Layer.provide(Spawner.live),
        Layer.provide(NodeServices.layer),
      ),
      scope,
    ),
  );
  return Context.get(context, HarnessThreads);
};

/** {@link FamiliesReader} for Promise tests, built over the node services in a scope the test closes. */
/** Pass `owned` to close the reader yourself; otherwise the running test closes it. */
export const familiesReader = async (
  owned?: Scope.Closeable,
): Promise<FamiliesReader["Service"]> => {
  const scope = owned ?? Scope.makeUnsafe();
  if (!owned)
    try {
      // effect-edge: test-runner
      onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
    } catch {
      // Outside a running test: a module fixture, closed with its worker.
    }
  // effect-edge: test-runner
  const context = await Effect.runPromise(
    Layer.buildWithScope(FamiliesReader.layer.pipe(Layer.provide(HostDocumentMarks.none), Layer.provide(NodeServices.layer)), scope),
  );
  return Context.get(context, FamiliesReader);
};

/** Run one Effect to a Promise: the test-runner edge for Promise-style assertions. */
export const settle = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  // effect-edge: test-runner
  Effect.runPromise(effect);

type Lifted<F> = F extends (...args: infer Args) => Effect.Effect<infer A, unknown, unknown>
  ? (...args: Args) => Promise<A>
  : F;
/** {@link MachineSources} with its census legs as Promise fakes, the shape older tests mock. */
export type PromiseMachineSources = {
  [K in keyof MachineSources]: K extends
    | "host"
    | "peers"
    | "sessions"
    | "documents"
    | "holdings"
    | "attachments"
    | "years"
    ? Lifted<MachineSources[K]>
    : MachineSources[K];
};

/** Lift a Promise fake into the Effect leg Machine reads; its rejection stays the failure value. */
export const liftLegs = (sources: PromiseMachineSources): MachineSources => {
  const lift =
    <Args extends unknown[], A>(leg: (...args: Args) => Promise<A>) =>
    (...args: Args) =>
      Effect.tryPromise({ try: () => leg(...args), catch: (error) => error });
  return {
    ...sources,
    host: lift(sources.host),
    peers: lift(sources.peers),
    sessions: lift(sources.sessions),
    documents: lift(sources.documents),
    holdings: lift(sources.holdings),
    attachments: lift(sources.attachments),
    years: lift(sources.years),
  };
};

/**
 * {@link MachineOwner} for Promise tests: the live layer over Promise-fake legs, built in a scope
 * the running test closes (which stops its poll and unsets the host face).
 */
export const machineOwner = (
  sources: PromiseMachineSources,
  options?: MachineOptions,
): MachineOwnerPromise => {
  return machineOwnerPromise(Context.get(testScoped(MachineOwner.layer(liftLegs(sources), options)), MachineOwner));
};

/** The live {@link Spawner} for Promise tests, owned like {@link captureStore}'s scope. */
export const testSpawner = (): Spawner["Service"] => {
  return Context.get(testScoped(Spawner.live), Spawner);
};

/**
 * {@link CaptureStore} for Promise tests: the live layer over `directory`, built in a scope the
 * running test closes. Two calls over one directory are two layers over the same files.
 */
export const captureStore = (directory: string, apsCachePath?: string): TakeoffCaptures => {
  return Context.get(testScoped(CaptureStore.layer(directory, apsCachePath)), CaptureStore);
};

/** A real adapter owned by the running test's scope. */
export async function testAdapter(...args: Parameters<typeof adapter.openAdapter>) {
  const scope = Scope.makeUnsafe();
  // effect-edge: test-runner
  onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  // effect-edge: test-runner
  const services = await Effect.runPromise(Layer.buildWithScope(Spawner.live, scope));
  // effect-edge: test-runner
  return Effect.runPromiseWith(Context.add(services, Scope.Scope, scope))(
    adapter.openAdapter(...args),
  );
}

export const testDocumentMarks = (bridge: RevitBridge["Service"]) =>
  Context.get(testScoped(HostDocumentMarks.layer.pipe(Layer.provide(Layer.succeed(RevitBridge, bridge)))), HostDocumentMarks);
/** `makeCallRoute` over one test journal: the routes yield the service, this test provides it. */
export const callRouteOver = (
  journal: ActionJournalService["Service"],
  ...args: Parameters<typeof makeCallRoute>
) => Layer.unwrap(makeCallRoute(...args)).pipe(Layer.provide(Layer.succeed(ActionJournalService, journal)));
export const testJournal = () => Context.get(testScoped(ActionJournalService.live(null)), ActionJournalService);
/**
 * A journal over `path` whose attempts are fibers in the running test's scope. Closing that scope
 * interrupts an attempt the test left open; the service Layer joins them instead.
 */
export const journalAt = (...args: Parameters<typeof makeActionJournal>) =>
  Context.get(
    testScoped(
      Layer.effect(ActionJournalService, makeActionJournal(...args)).pipe(
        // testScoped builds synchronously; undici's layer is async, so these tests use fetch.
        Layer.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
      ),
    ),
    ActionJournalService,
  );

export const pictureCaptures = (root: string) => Context.get(testScoped(PictureCaptureStore.layer(root)), PictureCaptureStore);
export const testDuctFiles = () => Context.get(testScoped(DuctFiles.layer()), DuctFiles);

export const testHostInputs = Layer.mergeAll(DuctFiles.layer(), PictureCaptureStore.layer(), HostDocumentMarks.layer);

/** Immediate native acknowledgements for read payload fixtures. Barrier tests supply their own handles. */
export const acknowledgedReadBridge = (bridge: RevitBridge["Service"]): RevitBridge["Service"] => ({
  ...bridge,
  invokeHandle: (key, input, session, openId, requestId) => Effect.gen(function* () {
    const attached = (yield* bridge.list).find((row) => row.sessionId === session)!;
    const answer = yield* Effect.cached(bridge.invoke(key, input, session, openId, requestId).pipe(
      Effect.orDie,
      Effect.map(({ value }) => ({
        value, nativeRequestId: requestId!,
        actualTarget: { processIncarnation: { pid: attached.processId!, startedAt: attached.processStartUtcUnixMs! }, openDocumentLifetime: openId ? { openId } : { kind: "session-only" as const } },
        freshness: { freshnessGeneration: null, freshnessEvidence: "unavailable" as const },
        cost: {}, outcome: "native-acknowledged" as const,
      })),
    ));
    return { answer, terminal: Effect.as(answer, "native-acknowledged" as const).pipe(Effect.orDie) };
  }),
});

export const testInputContext = () => Context.get(testScoped(HostInputContext.layer({ kind: "live" })), HostInputContext);
/** The native fixture has no parameter catalog; disclose that without inventing model options. */
export const unavailableFieldOptions = {
  descriptor:{key:"parameter-identities",mode:"Constraint",allowsCustomValue:false,dependsOn:[],requiredRuntimeMode:"LiveDocument"},
  items:[],result:{kind:"Unsupported",message:"Fixture does not provide parameter options"},
};
