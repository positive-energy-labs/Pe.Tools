import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, win32 } from "node:path";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import { z } from "zod";
import { DOCUMENT_IDENTITY_AUTHORITY, productIdentity } from "@pe/host-contracts/contracts";
import type {
  Access,
  ActionReceipt,
  MachineAccess,
  HeadGrant,
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
import { hostOwnership, productRoot } from "./host-ownership.ts";
import type { RevitBridge } from "./bridge.ts";
import type { Providers } from "./harness/providers.ts";
import { unreadLeg, type UpdateReader } from "./update-reader.ts";
import { hostActionJournal } from "./gateway-owner.ts";
import {
  acquiredOpenIds,
  foldAcquisitions,
  heldProcess,
  processWhose,
  type Acquisition,
} from "./acquisition.ts";
import { grantDead } from "./control.ts";
import { hostRedirectionTrust } from "./redirection-trust.ts";

export interface MachineShareAdapter {
  read(): Promise<MachineShare>;
  subscribe?(notify: () => void): () => void;
}
// TODO: wave 4 replaces this with the owner of the verified Serve mapping.
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

/** One thread's rw grant, as the head store holds it. */
export interface HeldGrant {
  readonly thread: string;
  readonly title: string;
  readonly grant: HeadGrant;
}

/** The thread-head store as Machine reads it: every grant, and a signal when any head moves. */
export interface GrantSource {
  grants(): readonly HeldGrant[];
  subscribe(notify: () => void): () => void;
}

/** What the bridge socket says; Machine adds `access`. */
export type AttachmentRead = Omit<MachineAttachment, "documents"> & {
  readonly documents: readonly Omit<MachineAttachmentDocument, "access">[] | null;
};

/**
 * Only acquisitions or unexpired exact-lifetime grants write; stale heads remain read-only. Both
 * join product openIds to SDK ids, so a socket that did not attest SDK identity writes nothing.
 */
function withAccess(
  attachment: AttachmentRead,
  acquired: ReadonlyMap<string, string>,
  grants: readonly HeldGrant[],
  at: number,
): MachineAttachment {
  const joined = attachment.documentIdentity === DOCUMENT_IDENTITY_AUTHORITY;
  return {
    ...attachment,
    documents:
      attachment.documents?.map((document): MachineAttachmentDocument => {
        if (!joined) return { ...document, access: { kind: "read" } };
        const held = grants.find(
          ({ grant }) =>
            grant.lifetime.session === document.session &&
            grant.lifetime.openId === document.openId &&
            grantDead(grant, at) === null,
        );
        const acquisition = acquired.get(document.openId);
        const access: MachineAccess = acquisition
          ? { kind: "pea", acquisition }
          : held
            ? {
                kind: "rw",
                context: held.thread,
                label: held.title,
                until: held.grant.expiresAt,
              }
            : { kind: "read" };
        return { ...document, access };
      }) ?? null,
  };
}

export interface MachineSources {
  grants: GrantSource;
  actions(this: void): Promise<readonly ActionReceipt[]>;
  host(this: void): Promise<Omit<MachineHost, "peers">>;
  peers(this: void): Promise<readonly MachinePeer[]>;
  sessions(this: void): Promise<readonly SessionObservation[]>;
  documents(this: void, process: ProcessIdentity): Promise<DocListResult>;
  holdings(this: void, process: ProcessIdentity): Promise<MachineSession["holdings"]>;
  attachments(this: void): Promise<readonly AttachmentRead[]>;
  years(this: void): Promise<readonly number[]>;
  providers(
    this: void,
  ): Promise<{ providers: readonly MachineProvider[]; access: Access; readError?: string | null }>;
  readonly update: UpdateReader["Service"];
  readonly share: MachineShareAdapter;
  subscribe?(this: void, notify: () => void): () => void;
}

/** One clock, one in-flight refresh, full confirmed data retained independently of every leg. */
/**
 * Every leg refreshes under one deadline. The first `machine` frame waits for every leg, so one
 * leg that never settles (a `pe-revit` spawn with no timeout, an APS call) was a tray that read
 * "reading this machine" forever (DELL_PE, 2026-10-12). Now it is a leg error in the frame.
 */
const LEG_DEADLINE_MS = 15_000;
const FEED_RETRY_MS = 2 * 60_000;
const ATTEMPT_CAP_MS = 6 * 60 * 60_000;

class LegDeadline extends Error {}

/**
 * A leg that stopped being readable: typed for the receipt spine, which publishes it once per
 * outage (the transition into failure), never once per 5 s tick of a stuck leg.
 */
export interface MachineLegFault {
  readonly leg: string;
  readonly kind: "deadline" | "error";
  readonly elapsedMs: number;
}

function withDeadline<A>(promise: Promise<A>, ms: number, key: string): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LegDeadline(`${key} leg exceeded ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createMachine(
  sources: MachineSources,
  options: {
    now?: () => string;
    periodMs?: number;
    updatePeriodMs?: number;
    automaticUpdates?: { peaActive(): boolean };
    /** The spine's intake for leg faults; absent where nothing observes them. */
    fault?: (fault: MachineLegFault) => void;
  } = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  // The update feed is GitHub's API at 60 unauthenticated calls an hour: it has its own clock, read
  // at boot and every updatePeriodMs. Recheck and newly eligible automatic updates read explicitly.
  // The 5 s machine tick recovers receipts without reading the feed.
  const updatePeriodMs = options.updatePeriodMs ?? 30 * 60_000;
  let updateDueAt = 0;
  let yearsDueAt = 0;
  let noRevitSince: number | null = null;
  let eligibleBefore = false;
  /** Feed-failure backoff: retry sooner than the 30 min cadence, never faster than 2 min. */
  let feedFailures = 0;
  /** Automatic attempts keyed by candidate version, not plan UUID (every feed check mints a plan). */
  let attempt: { candidate: string; count: number; notBefore: number } | null = null;
  let announced: string | null = null;
  const listeners = new Set<(value: Machine) => void>();
  let inFlight: Promise<Machine> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let release: (() => void) | undefined;
  let closed = false;
  let host: Omit<MachineHost, "peers"> | null = null;
  let peers: readonly MachinePeer[] = [];
  let sessions: readonly SessionObservation[] | null = null;
  let attachments: readonly AttachmentRead[] = [];
  let years: readonly number[] | null = null;
  let providers: readonly MachineProvider[] | null = null;
  let access: Access | null = null;
  let share: MachineShare | null = null;
  let legs: Record<string, MachineLeg> = {};
  /** The last fold of the journal this Machine read; an unread actions leg folds nothing. */
  let acquisitions: readonly Acquisition[] = [];
  const documents = new Map<string, { value: MachineSession["documents"]; leg: MachineLeg }>();
  const holdings = new Map<string, MachineSession["holdings"]>();
  let latest: Machine = {
    observedAtUtc: now(),
    host: null,
    revit: { years: null, sessions: null, unclassifiedAttachments: [] },
    update: sources.update.current(),
    share: null,
    providers: null,
    access: null,
    legs: {},
  };

  async function read<A>(key: string, acquire: () => Promise<A>, accept: (value: A) => void) {
    const attemptedAtUtc = now();
    const startedMs = Date.now();
    try {
      accept(await withDeadline(acquire(), LEG_DEADLINE_MS, key));
      legs[key] = { observedAtUtc: now(), attemptedAtUtc, error: null };
      return true;
    } catch (error) {
      const wasFailing = legs[key]?.error != null;
      legs[key] = { ...(legs[key] ?? unreadLeg()), attemptedAtUtc, error: String(error) };
      if (!wasFailing)
        options.fault?.({
          leg: key,
          kind: error instanceof LegDeadline ? "deadline" : "error",
          elapsedMs: Date.now() - startedMs,
        });
      return false;
    }
  }

  function refresh(): Promise<Machine> {
    if (closed) return Promise.resolve(latest);
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let actions: readonly ActionReceipt[] = [];
      const [censusRead, attachmentsRead] = await Promise.all([
        read("sessions", sources.sessions, (value) => {
          sessions = value;
        }),
        read("attachments", sources.attachments, (value) => {
          attachments = value;
        }),
        read("actions", sources.actions, (value) => {
          actions = value;
        }),
        read("host", sources.host, (value) => {
          host = value;
        }),
        read("peers", sources.peers, (value) => {
          peers = value;
        }),
        Date.now() >= yearsDueAt
          ? read(
              "years",
              () => {
                return sources.years().then((value) => {
                  yearsDueAt = Date.now() + updatePeriodMs;
                  return value;
                });
              },
              (value) => {
                years = value;
              },
            )
          : Promise.resolve(true),
        read("providers", sources.providers, (value) => {
          providers = value.providers;
          access = value.access;
          if (value.readError) throw Error(value.readError);
        }),
        read(
          "share",
          () => sources.share.read(),
          (value) => {
            share = value;
          },
        ),
        read(
          "update",
          () => {
            const checkFeed = Date.now() >= updateDueAt;
            if (checkFeed) updateDueAt = Date.now() + updatePeriodMs;
            return sources.update.refresh(checkFeed).then((value) => {
              if (checkFeed) {
                feedFailures = value.planLeg.error ? feedFailures + 1 : 0;
                if (feedFailures)
                  updateDueAt =
                    Date.now() + Math.min(updatePeriodMs, FEED_RETRY_MS * 2 ** (feedFailures - 1));
              }
              return value;
            });
          },
          () => {},
        ),
      ]);
      const policy = options.automaticUpdates;
      if (
        !censusRead ||
        !attachmentsRead ||
        (sessions ?? []).some(
          (row) => row.case !== "gone-receipt" && row.case !== "failed-receipt",
        ) ||
        attachments.length ||
        sessions === null
      )
        noRevitSince = null;
      else noRevitSince ??= Date.now();
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
        Date.now() - noRevitSince >= 120_000 &&
        !policy.peaActive();
      // A newly empty fleet or completed Pea turn needs a fresh plan, even inside the feed interval.
      if (eligible && !eligibleBefore) await sources.update.refresh(true);
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
          (attempt?.candidate !== candidate || Date.now() >= attempt.notBefore) &&
          (!update.requestId ||
            (update.receipt && ["ok", "failed", "refused"].includes(update.receipt.state)))
        ) {
          const count = attempt?.candidate === candidate ? attempt.count + 1 : 1;
          attempt = {
            candidate,
            count,
            notBefore: Date.now() + Math.min(ATTEMPT_CAP_MS, updatePeriodMs * 2 ** (count - 1)),
          };
          // The mutation outlives every observation deadline: the reader owns it and its exit
          // handoff. This tick never awaits it, so a long download is not a failed read.
          sources.update.apply(plan.planId, true).catch((error) => {
            legs["automatic-update"] = {
              ...(legs["automatic-update"] ?? unreadLeg()),
              attemptedAtUtc: now(),
              error: String(error),
            };
          });
        }
      }
      if (censusRead)
        await Promise.all(
          (sessions ?? []).map(async (row) => {
            const process = processOf(row);
            if (!process) return;
            const key = processKey(process);
            await read(
              `holdings:${key}`,
              () => sources.holdings(process),
              (value) => holdings.set(key, value),
            );
            if (row.case === "controlled-active") {
              const previous = documents.get(key) ?? { value: null, leg: unreadLeg() };
              documents.set(
                key,
                row.bridge.bridge === "ready"
                  ? {
                      value: row.bridge.documents,
                      leg: { observedAtUtc: row.observedAtUtc, attemptedAtUtc: now(), error: null },
                    }
                  : {
                      ...previous,
                      leg: {
                        ...previous.leg,
                        attemptedAtUtc: now(),
                        error: "SDK bridge is not answering.",
                      },
                    },
              );
            } else if (row.case === "observed-active") {
              const previous = documents.get(key) ?? { value: null, leg: unreadLeg() };
              const attemptedAtUtc = now();
              try {
                const result = await withDeadline(
                  sources.documents(process),
                  LEG_DEADLINE_MS,
                  `documents:${key}`,
                );
                documents.set(key, {
                  value: result.documents.map((doc) => ({ ...doc, persistence: null })),
                  leg: { observedAtUtc: now(), attemptedAtUtc, error: null },
                });
              } catch (error) {
                documents.set(key, {
                  ...previous,
                  leg: { ...previous.leg, attemptedAtUtc, error: String(error) },
                });
              }
            }
          }),
        );
      const classified = new Set<AttachmentRead>();
      acquisitions = foldAcquisitions(actions);
      const heldGrants = sources.grants.grants();
      const at = Date.parse(now());
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
                  allowed ? heldGrants : [],
                  at,
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
        observedAtUtc: now(),
        host: host ? { ...host, peers } : null,
        revit: {
          years,
          sessions: rows,
          // Nobody proved these Pea's, so they are yours: only a live grant writes.
          unclassifiedAttachments: attachments
            .filter((attachment) => !classified.has(attachment))
            .map((attachment) => withAccess(attachment, new Map(), [], at)),
        },
        update: sources.update.current(),
        share,
        providers,
        access,
        legs: { ...legs },
      };
      if (!closed) for (const accept of listeners) accept(latest);
      return latest;
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  function observe(accept: (value: Machine) => void) {
    if (closed) throw Error("Machine owner is retired.");
    listeners.add(accept);
    if (latest.legs.sessions) accept(latest);
    if (listeners.size === 1) {
      const notify = () => {
        void refresh();
      };
      const unwatch = sources.subscribe?.(notify);
      const ungrant = sources.grants.subscribe(notify);
      const unshare = sources.share.subscribe?.(notify);
      release = () => {
        ungrant();
        unwatch?.();
        unshare?.();
      };
      timer = setInterval(notify, options.periodMs ?? 5_000);
      void refresh();
    }
    return () => {
      listeners.delete(accept);
      if (!listeners.size) {
        clearInterval(timer);
        release?.();
        release = undefined;
      }
    };
  }
  return {
    refresh,
    // A mutation must not reuse a refresh that began before its request.
    fresh: async () => {
      await inFlight;
      if (closed) throw Error("Machine owner is retired.");
      return refresh();
    },
    observe,
    current: () => latest,
    acquisitions: () => acquisitions,
    close: () => {
      closed = true;
      clearInterval(timer);
      release?.();
      listeners.clear();
    },
  };
}
export type MachineOwner = ReturnType<typeof createMachine>;

/**
 * The host process's one Machine owner, for the ops that answer with SDK facts (the session
 * summary and list) but run outside the Machine's own routes. Set once at boot.
 */
let hostMachine: MachineOwner | undefined;
export function currentMachine(): Machine {
  if (!hostMachine) throw Error("Machine census is unavailable.");
  return hostMachine.current();
}

export const useHostMachine = (owner: MachineOwner | undefined) => {
  hostMachine = owner;
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
    void machine.refresh().catch(() => {});
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

async function sdk<A>(args: string[], acceptedExitCodes = [0]): Promise<Envelope<A>> {
  const stdout = await Effect.runPromise(
    runPeRevitCli(args).pipe(Effect.timeout(60_000), Effect.provide(NodeServices.layer)),
  );
  const envelope = JSON.parse(stdout) as Envelope<A>;
  if (!acceptedExitCodes.includes(envelope.exitCode))
    throw Error(
      envelope.diagnostics.map((d) => `${d.code}: ${d.detail}`).join("; ") ||
        `SDK exit ${envelope.exitCode}`,
    );
  return envelope;
}

export function machineSources(
  bridge: RevitBridge["Service"] | undefined,
  providers: Providers,
  update: UpdateReader["Service"],
  share: MachineShareAdapter = unavailableShare,
  grants: GrantSource = { grants: () => [], subscribe: () => () => {} },
): MachineSources {
  return {
    grants,
    actions: () => hostActionJournal().list(),
    host: async () => {
      const file = await readServiceFile(productRoot(), hostOwnership.serviceName);
      if (!file || file.pid !== process.pid)
        throw Error("This host has no matching SDK service identity.");
      const attachments = bridge ? await Effect.runPromise(bridge.list) : [];
      const runtimeRefusal = bridge
        ? await Effect.runPromise(bridge.lastRegistrationRefusal)
        : null;
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
        payload: hostOwnership.lane === "dev" ? "checkout" : "installed",
        process: { pid: file.pid, processStartUtc: file.processStartUtc },
        port: file.port,
        startedBy: null,
        autostart: await readAutostart(hostOwnership.executablePath),
        redirectionTrust: await hostRedirectionTrust(),
        sourceRoot: file.sourceRoot ?? null,
        installedRoot: hostOwnership.installedRoot,
        uptimeSeconds: process.uptime(),
        canonicalUrl: `http://127.0.0.1:${file.port}`,
      };
    },
    peers: () => readMachinePeers(productRoot(), hostOwnership.serviceName),
    sessions: async () => {
      const { result } = await sdk<SessionListResult>(sessionListArgv({ all: true }));
      if (!Array.isArray(result.sessions)) throw Error("SDK session census has no sessions array.");
      if (!Array.isArray(result.processReadErrors))
        throw Error("SDK session census has no process read evidence.");
      if (result.processReadErrors.length)
        throw Error(
          `SDK process census incomplete: ${result.processReadErrors
            .map((error) => `PID ${error.candidatePid}: ${error.detail}`)
            .join("; ")}`,
        );
      return result.sessions;
    },
    documents: async (process) => {
      const envelope = await sdk<DocListResult>(docListArgv({ pid: process.pid }));
      if (
        envelope.resolved?.pid !== process.pid ||
        envelope.resolved.processStartUtc !== process.processStartUtc
      )
        throw Error("Document read resolved a different process incarnation.");
      const result = z
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
        .parse(envelope.result);
      return result;
    },
    holdings: async (process) => {
      const envelope = await sdk<DocHoldingsListResult>(
        docListArgv({ pid: process.pid, holdings: true }),
      );
      if (
        envelope.resolved?.pid !== process.pid ||
        envelope.resolved.processStartUtc !== process.processStartUtc
      )
        throw Error("Holdings read resolved a different process incarnation.");
      if (
        envelope.result.state !== "ok" ||
        !(envelope.result.documents === null || Array.isArray(envelope.result.documents))
      )
        throw Error("SDK holdings census has no document evidence.");
      return envelope.result.documents;
    },
    attachments: () => bridgeAttachments(bridge),
    // Doctor can report unrelated wiring refusals while still identifying installed years.
    years: async () =>
      (
        await sdk<DoctorResult>(doctorArgv({ timeoutSeconds: 20 }), [0, 1, 3])
      ).result.revitYears.map((year) => {
        const number = Number(year);
        if (!Number.isInteger(number)) throw Error(`Invalid SDK Revit year ${year}`);
        return number;
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
export async function bridgeAttachments(
  bridge: Pick<RevitBridge["Service"], "list"> | undefined,
): Promise<readonly AttachmentRead[]> {
  if (!bridge) return [];
  return (await Effect.runPromise(bridge.list)).flatMap((view) =>
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
}

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
  } catch {
    return null;
  }
}
