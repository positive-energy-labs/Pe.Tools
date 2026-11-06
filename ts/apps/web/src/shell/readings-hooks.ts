import { canonicalRouteInput } from "../../../../packages/agent-contracts/src/route-doc";
/**
 * Transport subjects over the one source lifecycle admitted readings use (`openSourceReading`, which
 * owns deadline, failure and recovery); `#/readings` is only the wire. Hooks project its snapshot
 * onto the contract `Reading` so a View reads one vocabulary.
 *
 * A reading never feeds the page-wide busy sweep (ADR 0027 rule 9): pane heads say status.
 */
import {
  addressSchema,
  readingRequestSchema,
  type Reading,
  type ReadingRequest,
  type TargetInventory,
} from "@pe/agent-contracts";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/reactivity/Atom";
import { deepEqual } from "@tanstack/react-router";
import { useCallback, useContext, useMemo, useRef, useSyncExternalStore } from "react";
import type { Custody, Lane } from "@pe/host-contracts/contracts";
import {
  bridgeSessionsListSchema,
  type BridgeSessionListEntry,
  type HostOpResponse,
} from "@pe/host-contracts/operation-types";
import { Schema, Exit } from "effect";
import { reportFault } from "#/host/diagnostics";
import { peReadings, type Readings } from "#/readings";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { UseSource } from "./readings";
import { demandContext, openSourceReading } from "./readings-use";

export type { Lane };

/** How long a subject may stay silent with no evidence before it fails. */
const SUBJECT_WAIT_S = 30;

const absent: Reading<never> = { state: "absent" };
const absentAtom = Atom.make<Reading<never>>(absent);

/**
 * Revit changed this Reading's document after the host served it. The host owns the mark; a
 * surface draws this and offers a re-read. A Reading that is not ready is not "changed".
 */
export const changedInRevit = (reading: Reading<unknown>): boolean =>
  reading.state === "ready" && reading.changed === true;

export const previousOf = <T>(reading: Reading<T>): T | undefined =>
  reading.state === "ready"
    ? reading.observation
    : reading.state === "absent"
      ? undefined
      : reading.previous;

/** Re-types one Reading's observation without changing its lifecycle or its retained evidence. */
export const mapReading = <A, B>(reading: Reading<A>, project: (value: A) => B): Reading<B> =>
  reading.state === "ready"
    ? { ...reading, observation: project(reading.observation) }
    : reading.state === "stale"
      ? { ...reading, previous: project(reading.previous) }
      : reading.state === "absent"
        ? reading
        : { ...reading, previous: reading.previous ? project(reading.previous) : undefined };

const shallowSame = (a: object, b: object) => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key])
  );
};

/** One subject: publishes its projected Reading and returns its release. */
function subject(
  serialized: string,
  source: Readings,
  publish: (reading: Reading<unknown>) => void,
): () => void {
  const request = JSON.parse(serialized) as ReadingRequest;
  const meta: { changed?: boolean; reason: "gap" | "disconnected" } = { reason: "disconnected" };
  const deadline = Date.now() + SUBJECT_WAIT_S * 1000;
  const live: UseSource = {
    kind: "use",
    open(_context, deliver) {
      let revision = 0;
      return source.subscribe(request, (frame) => {
        if (frame.kind === "snapshot") {
          const inventory =
            request.kind === "inventory"
              ? Schema.decodeUnknownExit(bridgeSessionsListSchema)(frame.value)
              : null;
          if (inventory && Exit.isFailure(inventory)) {
            deliver({ kind: "failure", error: "Host inventory does not decode." });
            return;
          }
          meta.changed = frame.changed;
          deliver({
            kind: "complete",
            value: inventory && Exit.isSuccess(inventory) ? inventory.value : frame.value,
            revision: ++revision,
            fresh: !frame.stale,
          });
        } else if (frame.kind === "failure") deliver({ kind: "failure", error: frame.error });
        else if (frame.kind === "stale" || frame.kind === "gap") {
          meta.reason = frame.kind === "gap" ? "gap" : "disconnected";
          deliver({ kind: "stale" });
        }
      });
    },
  };
  const project = (snapshot: ReadingSnapshot<unknown>): Reading<unknown> => {
    if (snapshot.status === "ready" && snapshot.current)
      return {
        state: "ready",
        observation: snapshot.value,
        ...(meta.changed === undefined ? {} : { changed: meta.changed }),
      };
    if (snapshot.status === "failed")
      return {
        state: "failed",
        message: snapshot.reason ?? "unknown error",
        ...(snapshot.value !== undefined && { previous: snapshot.value }),
      };
    if (snapshot.value !== undefined)
      return { state: "stale", previous: snapshot.value, reason: meta.reason };
    if (meta.reason === "gap" && snapshot.status === "unavailable") return absent;
    return { state: "loading", requestId: serialized, deadline };
  };
  let last: Reading<unknown> = absent;
  const emit = (snapshot: ReadingSnapshot<unknown>) => {
    const next = project(snapshot);
    // Identical evidence keeps its identity (the transport already reuses identical frames).
    if (shallowSame(next, last)) return;
    last = next;
    publish(next);
  };
  emit({ status: "pending", current: false, reason: "Reading pending" });
  const controller = new AbortController();
  const close = openSourceReading(
    live,
    demandContext({ kind: "host" }, 0, null, controller.signal),
    emit,
    {
      live: {
        waitS: SUBJECT_WAIT_S,
        onTimeout: () =>
          reportFault(
            {
              code: "reading.timeout",
              elapsedMs: SUBJECT_WAIT_S * 1000,
              readingKind: request.kind,
            },
            Error(`reading ${serialized}: the host sent nothing before its deadline`),
          ),
      },
    },
  );
  return () => {
    controller.abort();
    close();
  };
}

const families = new WeakMap<Readings, (key: string) => Atom.Atom<Reading<unknown>>>();
const makeAtoms = (source: Readings) => {
  const family = Atom.family((serialized: string) =>
    Atom.make<Reading<unknown>>((get) => {
      let reading: Reading<unknown> = absent;
      let ready = false;
      get.addFinalizer(
        subject(serialized, source, (next) => {
          reading = next;
          if (ready) get.setSelf(next);
        }),
      );
      ready = true;
      return reading;
    }).pipe(Atom.setIdleTTL(0)),
  );
  return (key: string) => family(key);
};

/** One atom per subject, shared by every reader, over one engine node. */
export function readingAtom<T = unknown>(
  request: ReadingRequest,
  source: Readings = peReadings,
): Atom.Atom<Reading<T>> {
  let family = families.get(source);
  if (!family) {
    family = makeAtoms(source);
    families.set(source, family);
  }
  return family(canonicalRouteInput(readingRequestSchema.parse(request))) as Atom.Atom<Reading<T>>;
}

const atomOf = <T>(request: ReadingRequest | null, source: Readings) =>
  request ? readingAtom<T>(request, source) : (absentAtom as Atom.Atom<Reading<T>>);

/** A component's Reading. The request is keyed by subject, so a new object is not a new atom. */
export function useReading<T = unknown>(
  request: ReadingRequest | null,
  source: Readings = peReadings,
): Reading<T> {
  const key = request ? canonicalRouteInput(readingRequestSchema.parse(request)) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const atom = useMemo(() => atomOf<T>(request, source), [key, source]);
  return useAtomValue(atom);
}

/**
 * The slice of a Reading a component uses. A frame that leaves the slice structurally equal does
 * not notify, so a poll that moved other fields re-renders nobody here.
 */
export function useReadingSlice<T, S>(
  request: ReadingRequest | null,
  select: (reading: Reading<T>) => S,
  source: Readings = peReadings,
): S {
  const key = request ? canonicalRouteInput(readingRequestSchema.parse(request)) : null;
  const selectRef = useRef(select);
  selectRef.current = select;
  const registry = useContext(RegistryContext);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const atom = useMemo(() => atomOf<T>(request, source), [key, source]);
  const held = useRef<{ value: S } | undefined>(undefined);
  const subscribe = useCallback(
    (notify: () => void) => registry.subscribe(atom, notify),
    [registry, atom],
  );
  const snapshot = useCallback(() => {
    const value = selectRef.current(registry.get(atom));
    if (held.current && deepEqual(held.current.value, value, { ignoreUndefined: false }))
      return held.current.value;
    held.current = { value };
    return value;
  }, [registry, atom]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/* -- host-status: one subject, one cadence, both the gate read and the lamp ---------------- */

export interface PeInfo {
  controllerId?: string;
  capabilities: { revit?: boolean } & Record<string, unknown>;
  world?: unknown;
  bridgeIsConnected: boolean;
}

/** The `host-status` slice a component uses; see `useReadingSlice`. */
export const useHostStatusSlice = <S>(select: (reading: Reading<PeInfo>) => S, enabled = true): S =>
  useReadingSlice<PeInfo, S>(enabled ? { kind: "host-status" } : null, select);

/* -- Inventory: the open documents the host tracks, fused with the SDK census -------------- */

/** One Revit process incarnation, as observed by the broker. */
export interface SessionInventory {
  /** The BROKER's id: hash(pid + processStartUtc). Not the pe-revit session id. */
  sessionId: string;
  processId: number | null;
  processStartUtcUnixMs?: number | null;
  lane: Lane | null;
  /** The id `pe-revit session list` prints, when this payload was launched by pe-revit. */
  sdkSessionId?: string;
  year?: string;
  /** Disclosed by the broker. The UI never re-implements the SDK's `observed` refusal. */
  custody: Custody | null;
  activeDocumentId?: string;
  activeDocumentTitle?: string;
  openDocumentCount: number;
  openDocuments?: BridgeSessionListEntry["openDocuments"];
  openDocumentId?: string;
  observedAtUnixMs?: number;
}

const CUSTODIES: readonly Custody[] = ["controlled", "observed"];
const LANES: readonly Lane[] = ["dev", "installed"];

/** Wire entry (bridge.sessions.list) into inventory. Disconnected entries are not targets. */
export function inventoryOf(entries: readonly BridgeSessionListEntry[]): SessionInventory[] {
  return entries
    .filter((e) => e.connected)
    .map((e) => ({
      sessionId: e.sessionId,
      processId: e.processId ?? null,
      processStartUtcUnixMs: e.processStartUtcUnixMs ?? null,
      // Anything outside the SDK's union is no lane at all, not an invented "unknown" member.
      lane: LANES.find((l) => l === e.lane) ?? null,
      sdkSessionId: e.sdkSessionId ?? undefined,
      year: e.revitVersion ?? undefined,
      // Missing disclosure grants no custody fact.
      custody: CUSTODIES.find((c) => c === e.custody) ?? null,
      activeDocumentId: e.activeDocumentCloudModelGuid ?? e.activeDocumentPath ?? undefined,
      activeDocumentTitle: e.activeDocumentTitle ?? undefined,
      observedAtUnixMs: e.activeDocumentObservedAtUnixMs ?? undefined,
      openDocumentCount: e.openDocumentCount,
      openDocuments: e.openDocuments,
    }));
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
  const seen = previousOf(reading);
  if (reading.state === "failed" && !seen) return { kind: "failed", message: reading.message };
  if (!seen) return { kind: "checking" };
  const sessions: Extract<TargetInventory, { kind: "ready" }>["sessions"] = {};
  for (const session of seen.sessions) {
    sessions[session.sessionId] =
      !session.connected || session.openDocuments == null
        ? { kind: "checking" }
        : {
            kind: "ready",
            values: session.openDocuments.map((doc) => ({
              openId: doc.openId,
              address: addressSchema.safeParse(doc.address).data ?? null,
              kind: doc.isFamilyDocument ? ("family" as const) : ("project" as const),
            })),
          };
  }
  return { kind: "ready", sessions };
}

/** A value domain's options (the `revit.catalog.field-options` answer). */
export type FieldOptionsData = HostOpResponse<"revit.catalog.field-options">;

/**
 * The one door to a field's options: an `x-options.key` read from one named document, with the
 * context values its `dependsOn` names. No document or no key reads nothing. A LiveDocument key's
 * Reading carries Revit's change mark (`changedInRevit`).
 */
export const useFieldOptionsReading = (
  target: { session: string; openId: string } | null | undefined,
  key: string | undefined,
  context: Record<string, string> = {},
): Reading<FieldOptionsData> =>
  useReading<FieldOptionsData>(
    target && key
      ? {
          kind: "field-options",
          target: { session: target.session, openId: target.openId },
          key,
          context,
        }
      : null,
  );

/** Refetch gaps retain facts; only an observed close or absent session revokes them. */
export function retainTargetInventory(
  next: TargetInventory,
  last: TargetInventory,
): TargetInventory {
  if (next.kind !== "ready") return last.kind === "ready" ? last : next;
  if (last.kind !== "ready") return next;
  return {
    kind: "ready",
    sessions: Object.fromEntries(
      Object.entries(next.sessions).map(([id, value]) => [
        id,
        value.kind === "checking" ? (last.sessions[id] ?? value) : value,
      ]),
    ),
  };
}
