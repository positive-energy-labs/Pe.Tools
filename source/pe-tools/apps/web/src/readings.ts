/**
 * The read layer. One EventSource, one AtomRegistry, one vocabulary (fable law 5).
 *
 * A Reading is anything observed from Revit, the host, or disk. Every observation in the web app
 * arrives through `readingAtom` over `peReadings`; nothing else opens a connection and nothing
 * caches. A write is not a Reading: it is a plain async call whose success calls `dirty(request)`,
 * which reacquires that subject's snapshot from the host.
 *
 * This file absorbs host/resources.ts, host/resource-client.ts, host/queries.ts, host/live.ts,
 * host/fleet.ts, host/events.ts and the surviving half of host/target.ts.
 */
import {
  READING_MAX_FRAME_BYTES,
  READING_MAX_KEYS,
  readingFrameSchema,
  readingKey,
  readingRequestSchema,
  addressSchema,
  type Address,
  type Reading,
  type ReadingFrame,
  type ReadingRequest,
  type TargetInventory,
} from "@pe/agent-contracts";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeBridgeSessionId } from "@pe/host-contracts/contracts";
import type { Custody, Lane } from "@pe/host-contracts/contracts";
import type {
  BridgeObservation,
  ControlledActiveBridgeObservation,
  Envelope,
  FleetPhase,
  PendingBridgeObservation,
  ProcessIdentity,
  SessionListResult,
  SessionObservation,
  SessionReceipt,
} from "@pe/host-contracts/pe-revit-contract";
import type {
  BridgeSessionListEntry,
  HostOpRequest,
  HostSessionScope,
  OpCallArgs,
  OpKey,
} from "@pe/host-contracts/operation-types";
import { callHostRpc } from "#/host/client.ts";
import type { LoadedFamiliesMatrixRequest } from "#/host/loaded-families-view.ts";
import type { HostLane } from "@pe/host-contracts/service-identity";
import { peUrl, resolveWorkbenchConfig } from "#/workbench/config.ts";

export type { Custody, Lane };

/* -- The one wire ------------------------------------------------------------------------- */

type Frame = (ReadingFrame & { stale?: boolean }) | { kind: "stale"; key: string };
type Source = Pick<EventSource, "onopen" | "onmessage" | "onerror" | "close">;

/** One browser connection. This map owns subscriptions and retained evidence, never owner truth. */
export class PeReadings {
  private readonly entries = new Map<
    string,
    {
      request: ReadingRequest;
      listeners: Set<(frame: Frame) => void>;
      latest?: ReadingFrame;
      stale: boolean;
    }
  >();
  private source?: Source;
  /** The stream being replaced by a topology swap; closed once the replacement opens. */
  private retiring?: Source;
  private generation = 0;
  private scheduled = false;
  private pendingFenced = false;
  private retry?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    private readonly url: () => string,
    private readonly connect: (url: string) => Source = (url) => new EventSource(url),
  ) {}

  /** Retire this owner's transport. Idempotent, and one-way: no further request is ever issued. */
  close() {
    this.closed = true;
    this.generation++;
    this.scheduled = false;
    this.pendingFenced = false;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.source?.close();
    this.source = undefined;
    this.retiring?.close();
    this.retiring = undefined;
    this.entries.clear();
  }

  subscribe(raw: ReadingRequest, listener: (frame: Frame) => void): () => void {
    if (this.closed) throw Error("This Pe reading owner is retired");
    const request = readingRequestSchema.parse(raw);
    const key = readingKey(request);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= READING_MAX_KEYS) throw Error("Too many Pe reading subscriptions");
      entry = { request, listeners: new Set(), stale: true };
      this.entries.set(key, entry);
      this.schedule(false);
    }
    const found = entry;
    found.listeners.add(listener);
    if (found.latest) listener({ ...found.latest, stale: found.stale });
    if (found.stale) listener({ kind: "stale", key });
    return () => {
      found.listeners.delete(listener);
      if (found.listeners.size === 0 && this.entries.get(key) === found) {
        this.entries.delete(key);
        this.schedule(false);
      }
    };
  }

  /**
   * An Action succeeded, so this subject's retained observation is no longer evidence. Reconnect
   * reacquires every open subject's snapshot; a gap frame diagnoses loss, it never replaces one.
   */
  dirty(request: ReadingRequest) {
    if (this.entries.has(readingKey(request))) this.schedule();
  }

  private lose(retry: boolean) {
    this.generation++;
    this.source?.close();
    this.source = undefined;
    this.retiring?.close();
    this.retiring = undefined;
    for (const [key, entry] of this.entries) {
      entry.stale = true;
      for (const accept of entry.listeners) accept({ kind: "stale", key });
    }
    if (retry)
      this.retry = setTimeout(() => {
        this.retry = undefined;
        this.open();
      }, 1000);
  }

  /**
   * A topology change (a key joined or left) swaps the stream without fencing: subscribed keys
   * keep their evidence and never see `stale`, so the lamp cannot flicker on every mount. Only an
   * explicit invalidation (`dirty`) fences, because stale evidence must not survive a write.
   */
  private schedule(fenceNow = true) {
    if (this.closed) return;
    clearTimeout(this.retry);
    this.retry = undefined;
    // `subscribe` can be reached while React evaluates a new aggregate atom. Defer the reconnect
    // so it cannot update another render synchronously.
    if (fenceNow && !this.pendingFenced) {
      this.lose(false);
      this.pendingFenced = true;
    }
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      clearTimeout(this.retry);
      this.retry = undefined;
      this.pendingFenced = false;
      this.open();
    });
  }

  private open() {
    if (this.closed || this.entries.size === 0) return;
    const generation = this.generation;
    const url = new URL(this.url());
    url.searchParams.set(
      "keys",
      JSON.stringify([...this.entries.values()].map(({ request }) => request)),
    );
    // The old stream stays open until the replacement opens; its frames are ignored once replaced.
    this.retiring?.close();
    this.retiring = this.source;
    const source = this.connect(url.toString());
    this.source = source;
    const current = () => this.generation === generation && this.source === source;
    source.onopen = () => {
      if (!current()) return;
      this.retiring?.close();
      this.retiring = undefined;
    };
    const lost = () => {
      if (this.closed || !current()) return;
      this.lose(true);
    };
    source.onerror = lost;
    // Socket open proves no reading fresh. Each key must receive its owner acquisition.
    source.onmessage = (event) => {
      if (!current()) return;
      try {
        if (new TextEncoder().encode(event.data as string).byteLength > READING_MAX_FRAME_BYTES)
          throw Error("Reading frame exceeds limit");
        const frame = readingFrameSchema.parse(JSON.parse(event.data as string));
        const entry = this.entries.get(frame.key);
        if (!entry) return;
        if (frame.kind === "snapshot" || frame.kind === "failure") {
          entry.latest = frame;
          entry.stale = false;
        }
        for (const accept of entry.listeners) accept(frame);
      } catch {
        lost();
      }
    };
  }
}

export const peReadings = new PeReadings(() => peUrl(resolveWorkbenchConfig(), "/resources"));

export type Readings = Pick<PeReadings, "subscribe" | "dirty">;

/* -- Frames become the one lifecycle ------------------------------------------------------ */

const absent: Reading<never> = { state: "absent" };
const absentAtom = Atom.make<Reading<never>>(absent);

export const previousOf = <T>(reading: Reading<T>): T | undefined =>
  reading.state === "ready"
    ? reading.observation
    : reading.state === "absent"
      ? undefined
      : reading.previous;

/** Re-types one Reading's observation without changing its lifecycle or its retained evidence. */
export const mapReading = <A, B>(reading: Reading<A>, project: (value: A) => B): Reading<B> =>
  reading.state === "ready"
    ? { state: "ready", observation: project(reading.observation) }
    : reading.state === "stale"
      ? { ...reading, previous: project(reading.previous) }
      : reading.state === "absent"
        ? reading
        : { ...reading, previous: reading.previous ? project(reading.previous) : undefined };

/** One frame advances one Reading. Evidence from before an invalidation is never erased. */
export function advance<T>(reading: Reading<T>, frame: Frame): Reading<T> {
  const previous = previousOf(reading);
  switch (frame.kind) {
    case "snapshot":
      return { state: "ready", observation: frame.value as T };
    case "failure":
      return { state: "failed", message: frame.error, ...(previous !== undefined && { previous }) };
    case "gap":
      return previous === undefined ? absent : { state: "stale", previous, reason: "gap" };
    case "stale":
      return previous === undefined
        ? { state: "loading", requestId: frame.key, deadline: Date.now() + 30_000 }
        : { state: "stale", previous, reason: "disconnected" };
    default:
      return reading;
  }
}

const families = new WeakMap<Readings, (key: string) => Atom.Atom<Reading<unknown>>>();
const makeAtoms = (source: Readings) => {
  const family = Atom.family((serialized: string) =>
    Atom.make<Reading<unknown>>((get) => {
      let reading: Reading<unknown> = absent;
      get.addFinalizer(
        source.subscribe(JSON.parse(serialized) as ReadingRequest, (frame) => {
          const next = advance(reading, frame);
          if (next === reading) return;
          reading = next;
          get.setSelf(reading);
        }),
      );
      return reading;
    }).pipe(Atom.autoDispose),
  );
  return (key: string) => family(key);
};

/** The only way a View observes anything. One atom per subject, shared by every reader. */
export function readingAtom<T = unknown>(
  request: ReadingRequest,
  source: Readings = peReadings,
): Atom.Atom<Reading<T>> {
  let family = families.get(source);
  if (!family) {
    family = makeAtoms(source);
    families.set(source, family);
  }
  return family(JSON.stringify(readingRequestSchema.parse(request))) as Atom.Atom<Reading<T>>;
}

/** A component's Reading. The request is keyed by subject, so a new object is not a new atom. */
export function useReading<T = unknown>(
  request: ReadingRequest | null,
  source: Readings = peReadings,
): Reading<T> {
  const key = request ? readingKey(request) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const atom = useMemo(
    () => (request ? readingAtom<T>(request, source) : (absentAtom as Atom.Atom<Reading<T>>)),
    [key, source],
  );
  return useAtomValue(atom);
}

/** An Action succeeded; this subject's snapshot is reacquired from the host. */
export const dirty = (request: ReadingRequest, source: Readings = peReadings) =>
  source.dirty(request);

/** Imperative readers join the stream and release only their observation. */
export function readReading(
  request: ReadingRequest,
  signal: AbortSignal = AbortSignal.timeout(30_000),
  source: Readings = peReadings,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let release = () => {};
    let settled = false;
    const finish = (value?: unknown, error?: unknown) => {
      if (settled) return;
      settled = true;
      release();
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(undefined, signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    release = source.subscribe(request, (frame) => {
      if (frame.kind === "snapshot" && !frame.stale) finish(frame.value);
      else if (frame.kind === "failure" && !frame.stale) finish(undefined, Error(frame.error));
    });
    if (settled) release();
  });
}

/* -- TakeoffModel events: the one push channel that is not a subject ----------------------------- */

export function subscribeHostEvents<T>(listener: (event: T) => void): () => void {
  return peReadings.subscribe({ kind: "world" }, (frame) => {
    if (frame.kind === "event") listener(frame.value as T);
    else if (frame.kind === "gap" || frame.kind === "stale")
      listener({
        kind: "gap",
        atMs: Date.now(),
        sessionId: "",
        dropped: frame.kind === "gap" ? frame.dropped : null,
      } as T);
  });
}

export function useHostEvents<T>(enabled: boolean, onEvent: (event: T) => void) {
  useEffect(() => {
    if (!enabled) return;
    return subscribeHostEvents(onEvent);
  }, [enabled, onEvent]);
}

/* -- host-status: one subject, one cadence, both the gate read and the lamp ---------------- */

export interface PeInfo {
  controllerId?: string;
  resourceId?: string;
  capabilities: { revit?: boolean } & Record<string, unknown>;
  world?: unknown;
  bridgeIsConnected: boolean;
}

/** The shell lamp and every capability gate read the same Reading; the host polls it at 5s. */
export const useHostStatus = (enabled = true): Reading<PeInfo> =>
  useReading<PeInfo>(enabled ? { kind: "host-status" } : null);

/* -- Inventory: the open documents the host tracks, fused with the SDK census -------------- */

/** One Revit process incarnation, as observed by the broker. */
export interface SessionInventory {
  /** The BROKER's id: hash(pid + processStartUtc). Not the pe-revit session id. */
  sessionId: string;
  processId: number;
  processStartUtcUnixMs?: number | null;
  lane: Lane | null;
  /** The id `pe-revit session list` prints, when this payload was launched by pe-revit. */
  sdkSessionId?: string;
  year?: string;
  /** Disclosed by the broker. The UI never re-implements the SDK's `observed` refusal. */
  custody: Custody;
  activeDocumentId?: string;
  activeDocumentTitle?: string;
  openDocumentCount: number;
  openDocuments?: BridgeSessionListEntry["openDocuments"];
  openDocumentId?: string;
  observedAtUnixMs?: number;
}

const CUSTODIES: readonly Custody[] = ["controlled", "observed"];
const LANES: readonly Lane[] = ["dev", "installed"];

/** Mint the active Revit document identity. */
export const documentAddress = (session: SessionInventory): Address | null =>
  addressSchema.safeParse(session.activeDocumentId).data ?? null;

/** The id a Target names: the pe-revit session id when the payload has one, else the broker's. */
export const sessionKey = (session: SessionInventory): string =>
  session.sdkSessionId ?? session.sessionId;

/** Wire entry (bridge.sessions.list) into inventory. Disconnected entries are not targets. */
export function inventoryOf(entries: readonly BridgeSessionListEntry[]): SessionInventory[] {
  return entries
    .filter((e) => e.connected)
    .map((e) => ({
      sessionId: e.sessionId,
      processId: e.processId ?? 0,
      processStartUtcUnixMs: e.processStartUtcUnixMs ?? null,
      // Anything outside the SDK's union is no lane at all, not an invented "unknown" member.
      lane: LANES.find((l) => l === e.lane) ?? null,
      sdkSessionId: e.sdkSessionId ?? undefined,
      year: e.revitVersion ?? undefined,
      // An entry that predates `custody` is treated as observed: the read-only reading.
      custody: CUSTODIES.find((c) => c === e.custody) ?? "observed",
      activeDocumentId: e.activeDocumentCloudModelGuid ?? e.activeDocumentPath ?? undefined,
      activeDocumentTitle: e.activeDocumentTitle ?? undefined,
      observedAtUnixMs: e.activeDocumentObservedAtUnixMs ?? undefined,
      openDocumentCount: e.openDocumentCount,
      openDocuments: e.openDocuments,
    }));
}

/** `unattached`: Revit runs and the SDK answers, but the Pe.Tools add-in has not connected to this host. */
type InventoryPhase = FleetPhase | "failed" | "unattached";

/** One Revit as the sentence speaks about it and /instances tables it. */
export interface Inventory {
  /** The pe-revit session id when the SDK knows this Revit, else the bridge session id. */
  id: string;
  brokerSessionId?: string | null;
  custody: Custody;
  phase: InventoryPhase;
  detail: string;
  /** Host/UI lane. The SDK payload source calls `dev` checkouts `checkout`. */
  lane?: HostLane;
  pid?: number;
  /** Live bridge observation, when this Revit holds an open WebSocket to the host. */
  session?: SessionInventory;
  /** The SDK's own registry row, when `session list` knows this Revit. */
  row?: SessionObservation;
}

type ObservationView = readonly [InventoryPhase, string, ProcessIdentity?];

const assertNever = (value: never): never => {
  throw new Error(`unhandled session observation: ${JSON.stringify(value)}`);
};

const ACTIVE_PHASE = {
  ready: "ready",
  "unresponsive-endpoint": "unresponsive",
} satisfies Record<ControlledActiveBridgeObservation["bridge"], InventoryPhase>;
const PENDING_PHASE = {
  answering: "booting",
  "missing-endpoint": "booting",
} satisfies Record<PendingBridgeObservation["bridge"], InventoryPhase>;
const OBSERVED_VIEW = {
  answering: ["ready", "SDK bridge answers for this observed Revit process."],
  "missing-endpoint": [
    "unresponsive",
    "SDK bridge endpoint is missing for this observed Revit process.",
  ],
  "unresponsive-endpoint": [
    "unresponsive",
    "SDK bridge does not answer for this observed Revit process.",
  ],
} satisfies Record<BridgeObservation["bridge"], readonly [InventoryPhase, string]>;
const RECEIPT_LANE = {
  checkout: "dev",
  installed: "installed",
} satisfies Record<SessionReceipt["payload"], HostLane>;

function projectObservation(row: SessionObservation): ObservationView {
  switch (row.case) {
    case "controlled-active":
      return [ACTIVE_PHASE[row.bridge.bridge], row.detail, row.process];
    case "controlled-pending":
      switch (row.attempt.attempt) {
        case "awaiting-launch":
          return ["booting", row.detail];
        case "launched":
          return [PENDING_PHASE[row.attempt.bridge.bridge], row.detail, row.attempt.process];
        default:
          return assertNever(row.attempt);
      }
    case "observed-active": {
      const [phase, detail] = OBSERVED_VIEW[row.bridge.bridge];
      return [phase, detail, row.process];
    }
    case "gone-receipt":
      return ["gone", row.detail, row.process];
    case "failed-receipt":
      switch (row.failure.source) {
        case "journal":
          return ["failed", row.detail, row.failure.process];
        case "receipt":
          return ["failed", row.detail];
        default:
          return assertNever(row.failure);
      }
    default:
      return assertNever(row);
  }
}

/** Joins only one exact process incarnation; the SDK census owns every Revit's classification. */
export function inventoryView(
  rows: readonly (SessionObservation & { brokerSessionId?: string | null })[],
  sessions: readonly SessionInventory[],
): Inventory[] {
  const claimed = new Set<string>();
  const known: Inventory[] = rows.map((row) => {
    const [phase, detail, process] = projectObservation(row);
    const session = process
      ? sessions.find(
          (candidate) =>
            !claimed.has(candidate.sessionId) &&
            candidate.processId === process.pid &&
            candidate.processStartUtcUnixMs === Date.parse(process.processStartUtc),
        )
      : undefined;
    if (session) claimed.add(session.sessionId);
    const observed = row.case === "observed-active";
    // One meaning for "ready" everywhere: the host bridge holds this Revit. The SDK bridge alone
    // proves the payload loaded, not that scripts and operations can run (lamp and table agree).
    const unattached = phase === "ready" && !session;
    return {
      phase: unattached ? "unattached" : phase,
      detail: unattached
        ? "Revit is running, but the Pe.Tools add-in has not attached to this host: scripts and operations wait until it does."
        : detail,
      id: observed ? String(row.process.pid) : row.id,
      brokerSessionId: row.brokerSessionId,
      custody: observed ? "observed" : "controlled",
      lane: observed ? (session?.lane ?? undefined) : RECEIPT_LANE[row.receipt.payload],
      pid: process?.pid,
      session,
      row,
    } satisfies Inventory;
  });
  for (const session of sessions)
    if (!claimed.has(session.sessionId))
      known.push({
        id: session.sessionId,
        custody: "observed",
        phase: "ready",
        detail: "Host bridge is connected, but no exact SDK census row matched.",
        lane: session.lane ?? undefined,
        pid: session.processId,
        session,
      });
  return known;
}

/** The tracked open-document inventory, as the broker publishes it. */
export const useInventory = (enabled = true) =>
  useReading<{ sessions: BridgeSessionListEntry[] }>(enabled ? { kind: "inventory" } : null);

/**
 * The one Reading, as the one Target resolver reads it. A Reading that has not yet observed is
 * `checking`; a failed Reading says why; nothing here invents a session the host did not report.
 */
export function targetInventory(
  reading: Reading<{ sessions: BridgeSessionListEntry[] }>,
): TargetInventory {
  if (reading.state === "failed") return { kind: "failed", message: reading.message };
  const seen = previousOf(reading);
  if (!seen) return { kind: "checking" };
  const sessions: Record<
    string,
    {
      kind: "ready";
      values: { openId: string; address: Address | null; kind: "project" | "family" }[];
    }
  > = {};
  for (const session of inventoryOf(seen.sessions)) {
    sessions[session.sessionId] = {
      kind: "ready",
      values: (session.openDocuments ?? []).map((doc) => ({
        openId: doc.openId,
        address: addressSchema.safeParse(doc.address).data ?? null,
        kind: doc.isFamilyDocument ? ("family" as const) : ("project" as const),
      })),
    };
  }
  return { kind: "ready", sessions };
}

/** The one inventory the Target resolver reads. */
export const useTargetInventory = (enabled = true): TargetInventory =>
  targetInventory(useInventory(enabled));

/** Every Revit the SDK census knows, joined to the ones the bridge can see. */
export function useFleet() {
  const inventory = useInventory();
  // The SDK's default census is the live set; `--all` (the graveyard) is a census view, not a picker.
  const census = useReading<Envelope<SessionListResult>>({ kind: "sdk", read: "sessions" });
  const [brokerIds, setBrokerIds] = useState<ReadonlyMap<string, string>>(new Map());
  const result = previousOf(census)?.result;
  const rows = useMemo(() => result?.sessions ?? [], [result]);
  const rowKey = (row: SessionObservation): string =>
    row.case === "observed-active" ? String(row.process.pid) : row.id;
  useEffect(() => {
    let active = true;
    void Promise.all(
      rows.map(async (row): Promise<[string, string]> => {
        const process = projectObservation(row)[2];
        if (!process) return [rowKey(row), ""];
        const id = await computeBridgeSessionId({
          processId: process.pid,
          processStartUtcUnixMs: Date.parse(process.processStartUtc),
        });
        return [rowKey(row), id ?? ""];
      }),
    ).then((pairs) => {
      if (active) setBrokerIds(new Map(pairs));
    });
    return () => {
      active = false;
    };
  }, [rows]);
  const sessions = useMemo(() => inventoryOf(previousOf(inventory)?.sessions ?? []), [inventory]);
  return {
    worlds: inventoryView(
      rows.map((row) => ({ ...row, brokerSessionId: brokerIds.get(rowKey(row)) ?? null })),
      sessions,
    ),
    sessions,
    unreadableReceipts: result?.unreadableReceipts ?? [],
    processReadErrors: result?.processReadErrors ?? [],
    registryRoot: result?.registryRoot,
    isLoading: inventory.state === "loading" || census.state === "loading",
    // Stale = no settled observation, not "a refetch is in flight".
    stale: inventory.state !== "ready" || census.state !== "ready",
    error:
      inventory.state === "failed"
        ? Error(inventory.message)
        : census.state === "failed"
          ? Error(census.message)
          : null,
    basis: ["sessions.list", "bridge.sessions.list"],
  };
}

/* -- Host RPC: a call, not a subject ------------------------------------------------------ */

/**
 * A host operation read on mount. Not a Reading: it has no subject key and no owner, so it
 * carries no cache and no revalidation. Call `refresh` after a write that changes its answer.
 */
export function useHostCall<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  enabled = true,
) {
  const identity = useRef({ deps: [...deps], generation: 0 });
  if (!sameDeps(identity.current.deps, deps)) {
    identity.current = { deps: [...deps], generation: identity.current.generation + 1 };
  }
  const generation = identity.current.generation;
  const [state, setState] = useState<{
    data?: T;
    error?: Error;
    pending: boolean;
    generation: number;
  }>({ pending: enabled, generation });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setState({ pending: false, generation });
      return;
    }
    const controller = new AbortController();
    setState((current) =>
      current.generation === generation
        ? { ...current, pending: true }
        : { pending: true, generation },
    );
    void run(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, pending: false, generation });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState({ error: Error(String(error)), pending: false, generation });
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, nonce]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const visible = state.generation === generation ? state : { pending: enabled, generation };
  return {
    ...visible,
    isPending: visible.pending,
    isLoading: visible.pending,
    isSuccess: !visible.pending && visible.error === undefined && visible.data !== undefined,
    refresh,
  };
}

function sameDeps(left: readonly unknown[], right: readonly unknown[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  );
}

/**
 * An Action's run, as a component holds it: at most one in flight, its refusal kept, and its
 * success dirtying whatever Readings it names. Not a cache and not a queue.
 */
export function useAction<I, T>(
  run: (input: I) => Promise<T>,
  onSuccess?: (value: T, input: I) => void,
) {
  const [state, setState] = useState<{ pending: boolean; error?: Error }>({ pending: false });
  const mutateAsync = useCallback(
    async (input: I) => {
      setState({ pending: true });
      try {
        const value = await run(input);
        setState({ pending: false });
        onSuccess?.(value, input);
        return value;
      } catch (error) {
        setState({ pending: false, error: Error(String(error)) });
        throw error;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, onSuccess],
  );
  return {
    mutate: (input: I) => void mutateAsync(input).catch(() => {}),
    mutateAsync,
    isPending: state.pending,
    error: state.error,
  };
}

/* -- Host RPC reads: not Readings, just one call each over the one /call endpoint ------------ */

export const HOST_QUERY_KEY = ["pe-host"] as const;

type HostQueryOptions = HostSessionScope & { readonly enabled?: boolean };

/** Any operation key becomes a one-shot read. A Reading is for a subject the host pushes. */
export function useHostOp<K extends OpKey>(key: K, ...args: OpCallArgs<K, HostQueryOptions>) {
  const [request, options] = args;
  const { enabled, bridgeSessionId, openDocumentId } = options ?? {};
  const scope = { bridgeSessionId, openDocumentId };
  return useHostCall(
    // Cast: TS cannot resolve the conditional OpCallArgs tuple while K is open; the public
    // signatures on this hook and callHostRpc enforce it at call sites.
    () => callHostRpc(key, ...([request, scope] as OpCallArgs<K, HostSessionScope>)),
    [
      ...HOST_QUERY_KEY,
      bridgeSessionId ?? "",
      key,
      JSON.stringify(request ?? null),
      openDocumentId ?? "",
    ],
    enabled ?? true,
  );
}

export const useHostStatusQuery = (options?: HostQueryOptions) =>
  useHostOp("host.status", undefined, options);

export const useLoadedFamiliesMatrixQuery = (
  request: LoadedFamiliesMatrixRequest | undefined,
  options?: HostQueryOptions,
) =>
  useHostOp("revit.matrix.loaded-families", request as LoadedFamiliesMatrixRequest, {
    ...options,
    enabled: (options?.enabled ?? true) && Boolean(request),
  });

export const useFieldOptionsQuery = (
  request: HostOpRequest<"settings.field-options">,
  options?: HostQueryOptions,
) =>
  useHostOp("settings.field-options", request, {
    ...options,
    enabled:
      (options?.enabled ?? true) &&
      Boolean(request.moduleKey && request.propertyPath && request.sourceKey),
  });

export const useParameterCatalogQuery = (
  request: HostOpRequest<"settings.parameter-catalog">,
  options?: HostQueryOptions,
) =>
  useHostOp("settings.parameter-catalog", request, {
    ...options,
    enabled: (options?.enabled ?? true) && Boolean(request.moduleKey),
  });
