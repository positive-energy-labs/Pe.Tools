import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, win32 } from "node:path";
import { Cause, Clock, Context, Deferred, Effect, Layer, Queue, Schedule, Schema } from "effect";
import { z } from "zod";
import { DOCUMENT_IDENTITY_AUTHORITY, productIdentity } from "@pe/host-contracts/contracts";
import type {
  ActionReceipt,
  DocumentRef,
  MachineAccess,
  Machine,
  MachineAttachment,
  MachineAttachmentDocument,
  MachineHost,
  MachineLeg,
  MachinePeer,
  MachineProvider,
  MachineSession,
  MachineShare,
} from "@pe/agent-contracts";
import {
  docListArgv,
  doctorArgv,
  sessionListArgv,
  type DocListResult,
  type DocHoldingsListResult,
  type DoctorResult,
  type Envelope,
  type ProcessIdentity,
  type SessionListResult,
  type SessionObservation,
} from "@pe/host-contracts/pe-revit-contract";
import { discoverService, readServiceFile } from "@pe/host-contracts/pe-service";
import { runPeRevitCli } from "./session-route.ts";
import { hostOwnership } from "./host-ownership.ts";
import type { RevitBridge } from "./bridge.ts";
import type { Providers } from "./harness/providers.ts";
import { unreadLeg, type UpdateReader } from "./update-reader.ts";
import type { HostReceipts } from "./gateway-owner.ts";
import {
  acquiredOpenIds,
  foldAcquisitions,
  heldProcess,
  processWhose,
  type Acquisition,
} from "./acquisition.ts";
import { hostRedirectionTrust } from "./redirection-trust.ts";

export interface MachineShareAdapter {
  read(): Promise<MachineShare>;
  subscribe?(notify: () => void): () => void;
}
// TODO: docs/features/routes/LEDGER.md#s7-a1c2bf4a8e wave 4 replaces this with the owner of the verified Serve mapping.
export const unavailableShare: MachineShareAdapter = {
  read: async () => ({
    desired: "off",
    allowRemoteAdministration: true,
    state: "unknown",
    url: null,
    refusal: { code: "share.not-configured", detail: "Serve adapter is not configured." },
    callers: [],
    refused: [],
  }),
};

/** One user document a human added to a thread's targets, as the head store holds it. */
export interface HeldTarget {
  readonly thread: string;
  readonly title: string;
  readonly lifetime: DocumentRef;
}

/** The thread-head store as Machine reads it: every human-added target, and a signal when any head moves. */
export interface TargetSource {
  targets(): readonly HeldTarget[];
  subscribe(notify: () => void): () => void;
}

/** What the bridge socket says; Machine adds `access`. */
export type AttachmentRead = Omit<MachineAttachment, "documents"> & {
  readonly documents: readonly Omit<MachineAttachmentDocument, "access">[] | null;
};

/**
 * Acquisitions are Pea's; exact-lifetime human-added targets are a thread's. Both join product
 * openIds to SDK ids, so a socket that did not attest SDK identity is read-only here.
 */
/** Acquisition and Page/device target provenance only; Pea write capability comes from run consent. */
function withAccess(
  attachment: AttachmentRead,
  acquired: ReadonlyMap<string, string>,
  targets: readonly HeldTarget[],
): MachineAttachment {
  const joined = attachment.documentIdentity === DOCUMENT_IDENTITY_AUTHORITY;
  return {
    ...attachment,
    documents:
      attachment.documents?.map((document): MachineAttachmentDocument => {
        if (!joined) return { ...document, access: { kind: "read" } };
        const held = targets.find(
          ({ lifetime }) =>
            lifetime.session === document.session && lifetime.openId === document.openId,
        );
        const acquisition = acquired.get(document.openId);
        const access: MachineAccess = acquisition
          ? { kind: "pea", acquisition }
          : held
            ? { kind: "target", thread: held.thread, label: held.title }
            : { kind: "read" };
        return { ...document, access };
      }) ?? null,
  };
}

export interface MachineSources {
  targets: TargetSource;
  actions(this: void): Promise<readonly ActionReceipt[]>;
  host(this: void): Effect.Effect<Omit<MachineHost, "peers">, unknown>;
  peers(this: void): Effect.Effect<readonly MachinePeer[], unknown>;
  sessions(this: void): Effect.Effect<readonly SessionObservation[], unknown>;
  documents(this: void, process: ProcessIdentity): Effect.Effect<DocListResult, unknown>;
  holdings(this: void, process: ProcessIdentity): Effect.Effect<MachineSession["holdings"], unknown>;
  attachments(this: void): Effect.Effect<readonly AttachmentRead[], unknown>;
  years(this: void): Effect.Effect<readonly number[], unknown>;
  providers(
    this: void,
  ): Promise<{ providers: readonly MachineProvider[]; readError?: string | null }>;
  readonly update: UpdateReader["Service"];
  readonly share: MachineShareAdapter;
  subscribe?(this: void, notify: () => void): () => void;
}

/**
 * Every leg refreshes under one deadline. The first `machine` frame waits for every leg, so one
 * leg that never settles (a `pe-revit` spawn with no timeout, an APS call) was a tray that read
 * "reading this machine" forever (DELL_PE, 2026-10-12). Now it is a leg error in the frame.
 */
const LEG_DEADLINE_MS = 15_000;
/** The machine tick: it recovers receipts and census drift without reading the update feed. */
const POLL_PERIOD_MS = 5_000;
/** The update feed is GitHub's API at 60 unauthenticated calls an hour: read at boot and this often. */
const UPDATE_PERIOD_MS = 30 * 60_000;
/** Feed-failure backoff base: retry sooner than the 30 min cadence, never faster than 2 min. */
const FEED_RETRY_MS = 2 * 60_000;
/** An automatic update attempt for one candidate backs off by `updatePeriodMs * 2^n`, up to this. */
const ATTEMPT_CAP_MS = 6 * 60 * 60_000;
/** Revit must be absent this long before an automatic update may start. */
const NO_REVIT_QUIET_MS = 120_000;
/** One `pe-revit` CLI read. */
const SDK_DEADLINE_MS = 60_000;

/** A leg that did not settle inside {@link LEG_DEADLINE_MS}. */
export class LegDeadline extends Schema.TaggedError<LegDeadline>()("LegDeadline", {
  key: Schema.String,
  ms: Schema.Number,
}) {
  override get message() {
    return `${this.key} leg exceeded ${this.ms} ms`;
  }
}

/** A leg's source answered, but not with evidence Machine can use. */
export class MachineReadFailed extends Schema.TaggedError<MachineReadFailed>()(
  "MachineReadFailed",
  { message: Schema.String },
) {}

/** The owner's scope closed; nothing refreshes or observes any more. */
export class MachineRetired extends Schema.TaggedError<MachineRetired>()("MachineRetired", {}) {
  override get message() {
    return "Machine owner is retired.";
  }
}

/**
 * A leg that stopped being readable: typed for the receipt spine, which publishes it once per
 * outage (the transition into failure), never once per 5 s tick of a stuck leg.
 */
export interface MachineLegFault {
  readonly leg: string;
  readonly kind: "deadline" | "error";
  readonly elapsedMs: number;
}

export interface MachineOptions {
  /** The wall stamp on every leg; absent, `Clock` supplies it (a test's `TestClock` included). */
  now?: () => string;
  periodMs?: number;
  updatePeriodMs?: number;
  automaticUpdates?: { peaActive(): boolean };
  /** The spine's intake for leg faults; absent where nothing observes them. */
  fault?: (fault: MachineLegFault) => void;
}

/**
 * A leg's error as the wire has always spelled it: `Error: <message>`, so a tagged failure reads
 * as the plain `Error` it replaced; other throwables keep their own name.
 */
const legError = (error: unknown) =>
  error instanceof Error && "_tag" in error ? `Error: ${error.message}` : String(error);

/** A Promise-world source (the update reader, the journal) becomes a failure value carrying its cause. */
const attempt = <A>(evaluate: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: evaluate, catch: (error) => error });
/** A throwing parse is a leg failure, never a defect that would end the refresh fiber. */
const parsed = <A>(parse: () => A) => Effect.try({ try: parse, catch: (error) => error });

/** The feed's next due time after `failures` consecutive failed checks. */
const feedBackoffMs = (updatePeriodMs: number, failures: number) =>
  Math.min(updatePeriodMs, FEED_RETRY_MS * 2 ** (failures - 1));

/**
 * One clock, one in-flight refresh, full confirmed data retained independently of every leg.
 * Built in the layer's scope: the poll, the kick worker and every refresh are fibers forked into
 * it, so closing the scope stops polling and abandons nothing that a caller could still await.
 */
const makeMachineOwner = Effect.fn("MachineOwner.make")(function* (
  sources: MachineSources,
  options: MachineOptions = {},
) {
  const scope = yield* Effect.scope;
  const nowIso: Effect.Effect<string> = options.now
    ? Effect.sync(options.now)
    : Clock.currentTimeMillis.pipe(Effect.map((ms) => new Date(ms).toISOString()));
  // The update feed has its own clock, read at boot and every updatePeriodMs. Recheck and newly
  // eligible automatic updates read explicitly. The tick recovers receipts without reading the feed.
  const updatePeriodMs = options.updatePeriodMs ?? UPDATE_PERIOD_MS;
  let updateDueAt = 0;
  let yearsDueAt = 0;
  let noRevitSince: number | null = null;
  let eligibleBefore = false;
  /** Feed-failure count: the backoff is {@link feedBackoffMs}. */
  let feedFailures = 0;
  /** Automatic attempts keyed by candidate version, not plan UUID (every feed check mints a plan). */
  let attemptState: { candidate: string; count: number; notBefore: number } | null = null;
  let announced: string | null = null;
  const listeners = new Set<(value: Machine) => void>();
  let inFlight: Deferred.Deferred<Machine> | undefined;
  let release: (() => void) | undefined;
  let closed = false;
  let host: Omit<MachineHost, "peers"> | null = null;
  let peers: readonly MachinePeer[] = [];
  let sessions: readonly SessionObservation[] | null = null;
  let attachments: readonly AttachmentRead[] = [];
  let years: readonly number[] | null = null;
  let providers: readonly MachineProvider[] | null = null;
  let share: MachineShare | null = null;
  const legs: Record<string, MachineLeg> = {};
  /** The last fold of the journal this Machine read; an unread actions leg folds nothing. */
  let acquisitions: readonly Acquisition[] = [];
  const documents = new Map<string, { value: MachineSession["documents"]; leg: MachineLeg }>();
  const holdings = new Map<string, MachineSession["holdings"]>();
  let latest: Machine = {
    observedAtUtc: yield* nowIso,
    host: null,
    revit: { years: null, sessions: null, unclassifiedAttachments: [] },
    update: sources.update.current(),
    share: null,
    providers: null,
    legs: {},
  };

  /** Bound one source by the leg deadline; a stall is a typed failure, not an unsettled frame. */
  const deadline = <A, E>(effect: Effect.Effect<A, E>, key: string) =>
    effect.pipe(
      Effect.timeoutOrElse({
        duration: LEG_DEADLINE_MS,
        orElse: () => Effect.fail(new LegDeadline({ key, ms: LEG_DEADLINE_MS })),
      }),
    );

  const read = <A>(key: string, acquire: Effect.Effect<A, unknown>, accept: (value: A) => void) =>
    Effect.gen(function* () {
      const attemptedAtUtc = yield* nowIso;
      const startedMs = yield* Clock.currentTimeMillis;
      return yield* deadline(acquire, key).pipe(
        Effect.flatMap((value) => parsed(() => accept(value))),
        Effect.flatMap(() =>
          nowIso.pipe(
            Effect.map((observedAtUtc) => {
              legs[key] = { observedAtUtc, attemptedAtUtc, error: null };
              return true;
            }),
          ),
        ),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const error = Cause.squash(cause);
            const wasFailing = legs[key]?.error != null;
            legs[key] = { ...(legs[key] ?? unreadLeg()), attemptedAtUtc, error: legError(error) };
            if (!wasFailing)
              options.fault?.({
                leg: key,
                kind: error instanceof LegDeadline ? "deadline" : "error",
                elapsedMs: (yield* Clock.currentTimeMillis) - startedMs,
              });
            return false;
          }),
        ),
      );
    });

  const automaticFault = (error: unknown) =>
    nowIso.pipe(
      Effect.tap((attemptedAtUtc) =>
        Effect.sync(() => {
          legs["automatic-update"] = {
            ...(legs["automatic-update"] ?? unreadLeg()),
            attemptedAtUtc,
            error: legError(error),
          };
        }),
      ),
    );

  /** One census pass over every leg. It never fails: a bad leg is a leg error in the frame. */
  const collect = Effect.gen(function* () {
    let actions: readonly ActionReceipt[] = [];
    const startedAt = yield* Clock.currentTimeMillis;
    const [censusRead, attachmentsRead] = yield* Effect.all(
      [
        read("sessions", sources.sessions(), (value) => {
          sessions = value;
        }),
        read("attachments", sources.attachments(), (value) => {
          attachments = value;
        }),
        read("actions", attempt(sources.actions), (value) => {
          actions = value;
        }),
        read("host", sources.host(), (value) => {
          host = value;
        }),
        read("peers", sources.peers(), (value) => {
          peers = value;
        }),
        startedAt >= yearsDueAt
          ? read(
              "years",
              sources.years().pipe(
                Effect.tap(() =>
                  Clock.currentTimeMillis.pipe(
                    Effect.tap((at) =>
                      Effect.sync(() => {
                        yearsDueAt = at + updatePeriodMs;
                      }),
                    ),
                  ),
                ),
              ),
              (value) => {
                years = value;
              },
            )
          : Effect.succeed(true),
        read(
          "providers",
          attempt(sources.providers).pipe(
            Effect.tap((value) =>
              Effect.sync(() => {
                providers = value.providers;
              }),
            ),
            Effect.flatMap((value) =>
              value.readError
                ? Effect.fail(new MachineReadFailed({ message: value.readError }))
                : Effect.void,
            ),
          ),
          () => {},
        ),
        read(
          "share",
          attempt(() => sources.share.read()),
          (value) => {
            share = value;
          },
        ),
        read(
          "update",
          Effect.gen(function* () {
            const at = yield* Clock.currentTimeMillis;
            const checkFeed = at >= updateDueAt;
            if (checkFeed) updateDueAt = at + updatePeriodMs;
            const value = yield* attempt(() => sources.update.refresh(checkFeed));
            if (checkFeed) {
              feedFailures = value.planLeg.error ? feedFailures + 1 : 0;
              if (feedFailures)
                updateDueAt = (yield* Clock.currentTimeMillis) + feedBackoffMs(updatePeriodMs, feedFailures);
            }
            return value;
          }),
          () => {},
        ),
      ],
      { concurrency: "unbounded" },
    );
    const policy = options.automaticUpdates;
    const tickAt = yield* Clock.currentTimeMillis;
    if (
      !censusRead ||
      !attachmentsRead ||
      (sessions ?? []).some((row) => row.case !== "gone-receipt" && row.case !== "failed-receipt") ||
      attachments.length ||
      sessions === null
    )
      noRevitSince = null;
    else noRevitSince ??= tickAt;
    const offered = sources.update.current();
    // Once per version per host boot; the spine's id/revision dedupe covers the restart repeat.
    const latestVersion = offered.plan?.latest;
    // Automatic or not, the person hears once: with Revit always open, automatic can wait for days.
    if (policy && offered.plan?.available && latestVersion && latestVersion !== announced) {
      announced = latestVersion;
      sources.update.announce({
        kind: "available",
        version: latestVersion,
        automatic: offered.automatic,
      });
    }
    const eligible =
      policy !== undefined &&
      offered.automatic &&
      noRevitSince !== null &&
      tickAt - noRevitSince >= NO_REVIT_QUIET_MS &&
      !policy.peaActive();
    // A newly empty fleet or completed Pea turn needs a fresh plan, even inside the feed interval.
    if (eligible && !eligibleBefore)
      yield* attempt(() => sources.update.refresh(true)).pipe(
        Effect.catch((error) =>
          nowIso.pipe(
            Effect.tap((attemptedAtUtc) =>
              Effect.sync(() => {
                legs["update"] = {
                  ...(legs["update"] ?? unreadLeg()),
                  attemptedAtUtc,
                  error: legError(error),
                };
              }),
            ),
          ),
        ),
      );
    eligibleBefore = eligible;
    if (eligible && policy && !policy.peaActive() && !closed) {
      const update = sources.update.current();
      const plan = update.plan;
      const candidate = plan?.latest ?? plan?.planId ?? "";
      if (
        plan?.available &&
        !plan.revits.length &&
        !plan.blockers.length &&
        !update.planLeg.error &&
        (attemptState?.candidate !== candidate || tickAt >= attemptState.notBefore) &&
        (!update.requestId ||
          (update.receipt && ["ok", "failed", "refused"].includes(update.receipt.state)))
      ) {
        const count = attemptState?.candidate === candidate ? attemptState.count + 1 : 1;
        attemptState = {
          candidate,
          count,
          notBefore: tickAt + Math.min(ATTEMPT_CAP_MS, updatePeriodMs * 2 ** (count - 1)),
        };
        // The mutation outlives every observation deadline: the reader owns it and its exit
        // handoff. This tick never awaits it, so a long download is not a failed read.
        // Started here, so the call has been made by the time this pass settles; only the wait forks.
        const applying = yield* parsed(() => sources.update.apply(plan.planId, true)).pipe(
          Effect.catch((error) => automaticFault(error).pipe(Effect.as(null))),
        );
        if (applying)
          yield* Effect.forkIn(
            attempt(() => applying).pipe(Effect.asVoid, Effect.catch(automaticFault)),
            scope,
          );
      }
    }
    if (censusRead)
      yield* Effect.forEach(
        sessions ?? [],
        (row) =>
          Effect.gen(function* () {
            const process = processOf(row);
            if (!process) return;
            const key = processKey(process);
            yield* read(`holdings:${key}`, sources.holdings(process), (value) =>
              holdings.set(key, value),
            );
            const attemptedAtUtc = yield* nowIso;
            const previous = documents.get(key) ?? { value: null, leg: unreadLeg() };
            if (row.case === "controlled-active") {
              documents.set(
                key,
                row.bridge.bridge === "ready"
                  ? {
                      value: row.bridge.documents,
                      leg: { observedAtUtc: row.observedAtUtc, attemptedAtUtc, error: null },
                    }
                  : {
                      ...previous,
                      leg: { ...previous.leg, attemptedAtUtc, error: "SDK bridge is not answering." },
                    },
              );
            } else if (row.case === "observed-active") {
              yield* deadline(sources.documents(process), `documents:${key}`).pipe(
                Effect.flatMap((result) =>
                  nowIso.pipe(
                    Effect.map((observedAtUtc) =>
                      documents.set(key, {
                        value: result.documents.map((doc) => ({ ...doc, persistence: null })),
                        leg: { observedAtUtc, attemptedAtUtc, error: null },
                      }),
                    ),
                  ),
                ),
                Effect.catchCause((cause) =>
                  Effect.sync(() =>
                    documents.set(key, {
                      ...previous,
                      leg: { ...previous.leg, attemptedAtUtc, error: legError(Cause.squash(cause)) },
                    }),
                  ),
                ),
              );
            }
          }),
        { concurrency: "unbounded", discard: true },
      );
    const classified = new Set<AttachmentRead>();
    acquisitions = foldAcquisitions(actions);
    const heldTargets = sources.targets.targets();
    const rows =
      sessions?.map((row): MachineSession => {
        const process = processOf(row);
        const matched = process
          ? attachments.filter((attachment) => matches(attachment, process))
          : [];
        const attachment = matched.length === 1 ? matched[0]! : null;
        if (attachment) classified.add(attachment);
        const held = process ? documents.get(processKey(process)) : undefined;
        const allowed =
          row.execution?.allowed === true &&
          censusRead &&
          attachmentsRead &&
          held?.leg.observedAtUtc != null &&
          held.leg.error === null;
        return {
          row,
          whose: receiptProcessOf(row)
            ? processWhose(acquisitions, receiptProcessOf(row)!)
            : "you",
          attachment: attachment
            ? withAccess(
                attachment,
                allowed && process
                  ? acquiredOpenIds(
                      acquisitions,
                      process,
                      held?.value ?? null,
                      attachment.documents?.map((doc) => doc.openId) ?? [],
                    )
                  : new Map(),
                allowed ? heldTargets : [],
              )
            : null,
          documents: held?.value ?? null,
          documentsLeg: held?.leg ?? unreadLeg(),
          holdings: process ? (holdings.get(processKey(process)) ?? null) : null,
          holdingsLeg: process
            ? (legs[`holdings:${processKey(process)}`] ?? unreadLeg())
            : unreadLeg(),
        };
      }) ?? null;
    // Receipt/gone rows cannot keep old documents or classify a socket as currently attached.
    const currentKeys = new Set(
      (sessions ?? []).flatMap((row) => {
        const process = processOf(row);
        return process ? [processKey(process)] : [];
      }),
    );
    for (const key of documents.keys()) if (!currentKeys.has(key)) documents.delete(key);
    for (const key of holdings.keys())
      if (!currentKeys.has(key)) {
        holdings.delete(key);
        delete legs[`holdings:${key}`];
      }
    latest = {
      observedAtUtc: yield* nowIso,
      host: host ? { ...host, peers } : null,
      revit: {
        years,
        sessions: rows,
        // Nobody proved these Pea's or attested their identity, so they read as yours.
        unclassifiedAttachments: attachments
          .filter((attachment) => !classified.has(attachment))
          .map((attachment) => withAccess(attachment, new Map(), [])),
      },
      update: sources.update.current(),
      share,
      providers,
      legs: { ...legs },
    };
    if (!closed) for (const accept of listeners) accept(latest);
    return latest;
  });

  /**
   * Single flight: a second ask joins the pass in progress. The pass runs as a fiber of this scope,
   * so a caller that is interrupted (a browser that left) never cancels the pass others await.
   */
  const refresh: Effect.Effect<Machine> = Effect.suspend(() => {
    if (closed) return Effect.succeed(latest);
    if (inFlight) return Deferred.await(inFlight);
    const flight = Deferred.makeUnsafe<Machine>();
    inFlight = flight;
    return Effect.forkIn(
      collect.pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          Effect.sync(() => {
            inFlight = undefined;
          }).pipe(Effect.andThen(Deferred.done(flight, exit))),
        ),
      ),
      scope,
    ).pipe(Effect.andThen(Deferred.await(flight)));
  });

  // A mutation must not reuse a refresh that began before its request.
  const fresh: Effect.Effect<Machine, MachineRetired> = Effect.suspend(() =>
    inFlight ? Deferred.await(inFlight) : Effect.void,
  ).pipe(
    Effect.andThen(Effect.suspend(() => (closed ? Effect.fail(new MachineRetired()) : refresh))),
  );

  // Callback sources (the bridge, the thread heads, the share owner) cannot yield: they offer a
  // kick that one worker fiber drains into a refresh. A kick while a pass runs coalesces.
  const kick = yield* Queue.dropping<void>(1);
  const notify = () => {
    Queue.offerUnsafe(kick, undefined);
  };
  yield* Effect.forkIn(
    Queue.take(kick).pipe(Effect.andThen(refresh), Effect.forever),
    scope,
  );
  // The poll: a tick per period, but only while somebody observes.
  yield* Effect.forkIn(
    Effect.sync(() => {
      if (listeners.size) notify();
    }).pipe(Effect.repeat(Schedule.spaced(options.periodMs ?? POLL_PERIOD_MS))),
    scope,
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
      release?.();
      release = undefined;
      listeners.clear();
    }),
  );

  function observe(accept: (value: Machine) => void) {
    if (closed) throw new MachineRetired();
    listeners.add(accept);
    if (latest.legs.sessions) accept(latest);
    if (listeners.size === 1) {
      const unwatch = sources.subscribe?.(notify);
      const untarget = sources.targets.subscribe(notify);
      const unshare = sources.share.subscribe?.(notify);
      release = () => {
        untarget();
        unwatch?.();
        unshare?.();
      };
      notify();
    }
    return () => {
      listeners.delete(accept);
      if (!listeners.size) {
        release?.();
        release = undefined;
      }
    };
  }

  return {
    refresh,
    fresh,
    observe,
    current: () => latest,
    acquisitions: () => acquisitions,
  };
});

/**
 * The Machine census owner (ADR 0029 rule 3): built once in `peRoutesLayer`'s scope, closed with it.
 * A test swaps the sources and the clock, not a module.
 */
export class MachineOwner extends Context.Service<
  MachineOwner,
  Effect.Success<ReturnType<typeof makeMachineOwner>>
>()("pe/MachineOwner") {
  static readonly layer = (sources: MachineSources, options?: MachineOptions) =>
    Layer.effect(
      MachineOwner,
      Effect.gen(function* () {
        const owner = yield* makeMachineOwner(sources, options);
        // The Promise-world readers below (`currentMachine`, `processCustody`, ...) find the owner
        // through `hostMachine` until phase 5 gives them the service; its lifetime is this scope's.
        yield* Effect.acquireRelease(
          Effect.sync(() => useHostMachine(machineOwnerPromise(owner))),
          () => Effect.sync(() => useHostMachine(undefined)),
        );
        return owner;
      }),
    );
}

/**
 * The Promise face for callers that are not on a fiber yet: control binds, local ops and the
 * action doors. Sync reads pass through; the two asks cross one marked edge.
 */
export const machineOwnerPromise = (machine: MachineOwner["Service"]) => {
  const edge = <A, E>(effect: Effect.Effect<A, E>) =>
    // effect-edge: island, phase 5
    Effect.runPromise(effect);
  return {
    refresh: () => edge(machine.refresh),
    fresh: () => edge(machine.fresh),
    observe: machine.observe,
    current: machine.current,
    acquisitions: machine.acquisitions,
  };
};
export type MachineOwnerPromise = ReturnType<typeof machineOwnerPromise>;

/**
 * The host process's one Machine owner, for the ops that answer with SDK facts (the session
 * summary and list) but run outside the Machine's own routes. Set once at boot.
 */
let hostMachine: MachineOwnerPromise | undefined;
export function currentMachine(): Machine {
  if (!hostMachine) throw Error("Machine census is unavailable.");
  return hostMachine.current();
}

export const useHostMachine = (owner: MachineOwnerPromise | undefined) => {
  hostMachine = owner;
};

/**
 * The owner as routes built before its layer see it: every call resolves the host's owner at call
 * time, so a route never holds a retired one.
 */
const liveMachine = () => {
  if (!hostMachine) throw Error("Machine census is unavailable.");
  return hostMachine;
};
export const hostMachineFace: MachineOwnerPromise = {
  refresh: () => liveMachine().refresh(),
  fresh: () => liveMachine().fresh(),
  observe: (accept) => liveMachine().observe(accept),
  current: () => liveMachine().current(),
  acquisitions: () => liveMachine().acquisitions(),
};

/**
 * What the SDK census says about one process: `controlled` (pe-revit holds a receipt) or
 * `observed` (it does not). Null while the census has not answered; asking starts the first
 * read, so a host nobody is watching still learns the answer for the next ask.
 */
export function processCustody(
  pid: number | null | undefined,
  processStartUtcUnixMs: number | null | undefined,
): "controlled" | "observed" | null {
  const machine = hostMachine;
  if (!machine || !pid) return null;
  const latest = machine.current();
  if (!latest.legs.sessions) {
    void machine.refresh().catch((error) => {
      console.error("machine: asynchronous operation failed", error);
    });
    return null;
  }
  const row = latest.revit.sessions?.find((session) => {
    const process = receiptProcessOf(session.row);
    return (
      process?.pid === pid &&
      (processStartUtcUnixMs == null ||
        Date.parse(process.processStartUtc) === processStartUtcUnixMs)
    );
  });
  return row ? (row.row.case === "observed-active" ? "observed" : "controlled") : null;
}

/** Fresh SDK documents and the exact process attachment, never retained error-leg data. */
export async function readMachineSession(process: {
  pid: number;
  processStartUtc: string;
}): Promise<MachineSession> {
  if (!hostMachine) throw Error("Machine census is unavailable.");
  const machine = await hostMachine.fresh();
  for (const key of ["sessions", "attachments", "actions"]) {
    const leg = machine.legs[key];
    if (!leg?.observedAtUtc || leg.error)
      throw Error(`Machine ${key} census is unavailable: ${leg?.error ?? "unread"}`);
  }
  const rows =
    machine.revit.sessions?.filter(
      ({ row }) =>
        (row.case === "controlled-active" || row.case === "observed-active") &&
        row.process.pid === process.pid &&
        row.process.processStartUtc === process.processStartUtc,
    ) ?? [];
  const row = rows.length === 1 ? rows[0] : undefined;
  if (!row || !row.documents || !row.documentsLeg.observedAtUtc || row.documentsLeg.error)
    throw Error(
      `Machine has no fresh document census for the exact process incarnation${row?.documentsLeg.error ? `: ${row.documentsLeg.error}` : "."}`,
    );
  if (machine.revit.unclassifiedAttachments.some((attachment) => matches(attachment, process)))
    throw Error("Machine cannot join the process to one exact bridge attachment.");
  if (row.attachment && row.attachment.documentIdentity !== DOCUMENT_IDENTITY_AUTHORITY)
    throw Error("The bridge attachment does not attest SDK document identity; no document joins.");
  return row;
}

/** The acquisition that holds one exact product lifetime now; unproven (no census) is none. */
export function machineAcquisition(lifetime: { session: string; openId: string }): string | null {
  for (const row of hostMachine?.current().revit.sessions ?? [])
    for (const doc of row.attachment?.documents ?? [])
      if (doc.session === lifetime.session && doc.openId === lifetime.openId)
        return doc.access.kind === "pea" ? doc.access.acquisition : null;
  return null;
}

/** The held acquisition that started the Revit behind one bridge session; none when unproven. */
export function machineSessionAcquisition(session: string): string | null {
  const row = hostMachine
    ?.current()
    .revit.sessions?.find((each) => each.attachment?.session === session);
  const process = row ? processOf(row.row) : null;
  return process ? (heldProcess(hostMachine!.acquisitions(), process)?.id ?? null) : null;
}

/** A failed journal retains provenance, but does not certify a live attachment or document read. */
const receiptProcessOf = (row: SessionObservation): ProcessIdentity | null =>
  row.case === "failed-receipt" && row.failure.source === "journal"
    ? row.failure.process
    : processOf(row);

function processOf(row: SessionObservation): ProcessIdentity | null {
  return row.case === "controlled-active" || row.case === "observed-active"
    ? row.process
    : row.case === "controlled-pending" && row.attempt.attempt === "launched"
      ? row.attempt.process
      : null;
}
const processKey = (process: ProcessIdentity) => `${process.pid}:${process.processStartUtc}`;
const matches = (
  attachment: AttachmentRead,
  process: Pick<ProcessIdentity, "pid" | "processStartUtc">,
) =>
  attachment.pid === process.pid &&
  attachment.processStartUtcUnixMs !== null &&
  attachment.processStartUtcUnixMs === Date.parse(process.processStartUtc);

/** One `pe-revit` read. Its environment is `never`: the launcher spawns through `runHostChild`. */
const sdk = Effect.fn("machine.sdk")(function* <A>(args: string[], acceptedExitCodes = [0]) {
  const stdout = yield* runPeRevitCli(args).pipe(Effect.timeout(SDK_DEADLINE_MS));
  const envelope = yield* parsed(() => JSON.parse(stdout) as Envelope<A>);
  if (!acceptedExitCodes.includes(envelope.exitCode))
    return yield* new MachineReadFailed({
      message:
        envelope.diagnostics.map((d) => `${d.code}: ${d.detail}`).join("; ") ||
        `SDK exit ${envelope.exitCode}`,
    });
  return envelope;
});

const unreadable = (message: string) => new MachineReadFailed({ message });

export function machineSources(
  receipts: HostReceipts["Service"],
  bridge: RevitBridge["Service"] | undefined,
  providers: Providers,
  update: UpdateReader["Service"],
  share: MachineShareAdapter = unavailableShare,
  targets: TargetSource = { targets: () => [], subscribe: () => () => {} },
): MachineSources {
  return {
    targets,
    actions: () => receipts.journal.list(),
    host: Effect.fn("machine.host")(function* () {
      const file = yield* attempt(() => readServiceFile(hostOwnership.rootPath, hostOwnership.serviceName));
      if (!file || file.pid !== process.pid)
        return yield* unreadable("This host has no matching SDK service identity.");
      const attachments = bridge ? yield* bridge.list : [];
      const runtimeRefusal = bridge ? yield* bridge.lastRegistrationRefusal : null;
      return {
        runtimeMatch: attachments.length
          ? attachments.every((attachment) => attachment.runtimeMatch === "verified")
            ? ("verified" as const)
            : ("unknown" as const)
          : runtimeRefusal
            ? ("refused" as const)
            : ("disconnected" as const),
        runtimeRefusal,
        serviceName: hostOwnership.serviceName,
        instanceId: file.instanceId,
        version: file.version,
        payload: hostOwnership.lane === "dev" ? ("checkout" as const) : ("installed" as const),
        process: { pid: file.pid, processStartUtc: file.processStartUtc },
        port: file.port,
        startedBy: null,
        autostart: yield* attempt(() => readAutostart(hostOwnership.executablePath)),
        redirectionTrust: yield* attempt(() => hostRedirectionTrust()),
        sourceRoot: file.sourceRoot ?? null,
        installedRoot: hostOwnership.installedRoot,
        uptimeSeconds: process.uptime(),
        canonicalUrl: `http://127.0.0.1:${file.port}`,
      };
    }),
    peers: () => attempt(() => readMachinePeers(hostOwnership.rootPath, hostOwnership.serviceName)),
    sessions: Effect.fn("machine.sessions")(function* () {
      const { result } = yield* sdk<SessionListResult>(sessionListArgv({ all: true }));
      if (!Array.isArray(result.sessions))
        return yield* unreadable("SDK session census has no sessions array.");
      if (!Array.isArray(result.processReadErrors))
        return yield* unreadable("SDK session census has no process read evidence.");
      if (result.processReadErrors.length)
        return yield* unreadable(
          `SDK process census incomplete: ${result.processReadErrors
            .map((error) => `PID ${error.candidatePid}: ${error.detail}`)
            .join("; ")}`,
        );
      return result.sessions;
    }),
    documents: Effect.fn("machine.documents")(function* (process: ProcessIdentity) {
      const envelope = yield* sdk<DocListResult>(docListArgv({ pid: process.pid }));
      if (
        envelope.resolved?.pid !== process.pid ||
        envelope.resolved.processStartUtc !== process.processStartUtc
      )
        return yield* unreadable("Document read resolved a different process incarnation.");
      return yield* parsed(() =>
        z
          .object({
            state: z.literal("ok"),
            documents: z.array(
              z.object({
                sessionId: z.string(),
                openId: z.string().nullable(),
                title: z.string().nullable(),
                path: z.string().nullable(),
                isModified: z.boolean(),
                isActive: z.boolean(),
                isFamily: z.boolean(),
                window: z.string().nullable(),
                // Native facts (beta.203): null is a read that failed, never independence.
                isWorkshared: z.boolean().nullable(),
                isDetached: z.boolean().nullable(),
                isCloud: z.boolean().nullable(),
                centralPath: z.string().nullable(),
                region: z.string().nullable(),
                projectGuid: z.string().nullable(),
                modelGuid: z.string().nullable(),
              }),
            ),
          })
          .parse(envelope.result),
      );
    }),
    holdings: Effect.fn("machine.holdings")(function* (process: ProcessIdentity) {
      const envelope = yield* sdk<DocHoldingsListResult>(
        docListArgv({ pid: process.pid, holdings: true }),
      );
      if (
        envelope.resolved?.pid !== process.pid ||
        envelope.resolved.processStartUtc !== process.processStartUtc
      )
        return yield* unreadable("Holdings read resolved a different process incarnation.");
      if (
        envelope.result.state !== "ok" ||
        !(envelope.result.documents === null || Array.isArray(envelope.result.documents))
      )
        return yield* unreadable("SDK holdings census has no document evidence.");
      return envelope.result.documents;
    }),
    attachments: () => bridgeAttachments(bridge),
    // Doctor can report unrelated wiring refusals while still identifying installed years.
    years: Effect.fn("machine.years")(function* () {
      const { result } = yield* sdk<DoctorResult>(doctorArgv({ timeoutSeconds: 20 }), [0, 1, 3]);
      return yield* Effect.forEach(result.revitYears, (year) => {
        const number = Number(year);
        return Number.isInteger(number)
          ? Effect.succeed(number)
          : Effect.fail(unreadable(`Invalid SDK Revit year ${year}`));
      });
    }),
    providers: () => providers.snapshot(),
    update,
    share,
    subscribe: (notify) => {
      const unbridge = bridge?.subscribe(() => notify());
      const unproviders = providers.subscribe(notify);
      return () => {
        unbridge?.();
        unproviders();
      };
    },
  };
}

/** What the bridge socket says about each connected session: the one projection Machine reads. */
export const bridgeAttachments = Effect.fn("machine.attachments")(function* (
  bridge: Pick<RevitBridge["Service"], "list"> | undefined,
) {
  if (!bridge) return [] as readonly AttachmentRead[];
  return (yield* bridge.list).flatMap((view): AttachmentRead[] =>
    view.connected && view.sessionId && view.processId
      ? [
          {
            session: view.sessionId,
            pid: view.processId,
            processStartUtcUnixMs: view.processStartUtcUnixMs ?? null,
            documentIdentity:
              view.state?.documentIdentity === DOCUMENT_IDENTITY_AUTHORITY
                ? DOCUMENT_IDENTITY_AUTHORITY
                : null,
            documents: view.state
              ? view.state.openDocuments.map((doc) => ({
                  session: view.sessionId!,
                  openId: doc.openId,
                  title: doc.title,
                  address: doc.address ?? null,
                  isFamilyDocument: doc.isFamilyDocument,
                  isActive: doc.isActive,
                }))
              : null,
          },
        ]
      : [],
  );
});

/** Read/discover only: stale files remain visible and no display sweeps another host's record. */
async function readMachinePeers(
  appBase: string,
  ownServiceName: string,
): Promise<readonly MachinePeer[]> {
  const names = await readdir(join(appBase, "state", "service")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const rows = await Promise.all(
    names
      .filter((name) => name.startsWith("host-source-") && name.endsWith(".json"))
      .map(async (filename) => {
        const serviceName = filename.slice(0, -5);
        if (serviceName === ownServiceName) return null;
        const file = await readServiceFile(appBase, serviceName);
        if (!file || file.lane !== "dev") return null;
        const live = await discoverService(appBase, serviceName, { verifyOwner: true });
        let reachable = false;
        if (live?.instanceId === file.instanceId && file.health) {
          const url = new URL(file.health, `http://127.0.0.1:${file.port}`);
          if (url.origin === `http://127.0.0.1:${file.port}`)
            reachable = await fetch(url, {
              signal: AbortSignal.timeout(2_000),
              redirect: "error",
            }).then(
              (r) => r.ok,
              () => false,
            );
        }
        return {
          serviceName,
          instanceId: file.instanceId,
          version: file.version,
          sourceRoot: file.sourceRoot ?? null,
          process: { pid: file.pid, processStartUtc: file.processStartUtc },
          url: `http://127.0.0.1:${file.port}`,
          reachable,
        } satisfies MachinePeer;
      }),
  );
  return rows.filter((row): row is MachinePeer => row !== null);
}

/** Read Windows' Run and StartupApproved values; never enable an entry the user disabled. */
async function readAutostart(executablePath: string): Promise<MachineHost["autostart"]> {
  if (process.platform !== "win32" || hostOwnership.lane !== "installed") return null;
  const name = productIdentity.productName.replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; $r=Get-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue; $a=Get-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' -ErrorAction SilentlyContinue; $command=if($r){$r.GetValue('${name}')}else{$null}; $approved=if($a){$a.GetValue('${name}')}else{$null}; [pscustomobject]@{command=$command;approved=$approved} | ConvertTo-Json -Compress`;
  try {
    const stdout = await new Promise<string>((resolve, reject) =>
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 3_000 },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    );
    const entry = z
      .object({ command: z.string().nullable(), approved: z.array(z.number()).nullable() })
      .parse(JSON.parse(stdout));
    const image = entry.command && /^"?(.+?\.exe)"?(?:\s|$)/i.exec(entry.command)?.[1];
    if (
      !image ||
      win32.normalize(image).toLowerCase() !== win32.normalize(executablePath).toLowerCase()
    )
      return "off";
    const approval = entry.approved?.[0];
    if (approval === 3 || approval === 7) return "disabled-in-windows";
    return approval === undefined || approval === 2 || approval === 6 ? "on" : null;
  } catch (error) {
    console.warn("ts/apps/host/src/machine.ts: fallback after failure", error);
    return null;
  }
}
