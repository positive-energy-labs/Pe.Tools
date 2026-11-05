/**
 * The per-document change mark, held by the host. Revit's `document-changed` event names the
 * documents that changed (`changedOpenIds`); this holds, per exact open document, when the last
 * one arrived on the host's own clock. Freshness is that mark against when the host served a
 * Reading — never a timer, never an age.
 *
 * A detached bridge marks the whole session at the moment we went blind: nothing can be known
 * about a model we are not attached to, so every Reading taken before that moment is changed until
 * it is read again.
 */
import { Effect } from "effect";
import { BridgeError, type RevitBridge } from "./bridge.ts";

export interface DocumentRef {
  readonly session: string;
  readonly openId: string;
}

export interface DocumentMarks {
  /** Earliest read this host can judge against its own observed change events. */
  readonly observedSince?: number;
  /** When this exact open document last changed in Revit, or null while it never has. */
  readonly changedAt: (ref: DocumentRef) => number | null;
  /** Fires whenever any mark moves. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Resolves once every event the host has received so far is reflected in the marks; a fake has none pending. */
  readonly settled?: () => Promise<void>;
}

const NO_MARKS: DocumentMarks = { changedAt: () => null, subscribe: () => () => {} };

/** The one refusal an apply over a newer change mark gets. */
export const STALE_READ = "This read is no longer verified against Revit; read again, then apply.";

/** An apply rests on the read taken at `takenAt`; a later mark on its document refuses it undispatched. */
export function assertFresh(marks: DocumentMarks, ref: DocumentRef, takenAt: string | null): void {
  const at = takenAt === null ? Number.NaN : Date.parse(takenAt);
  if (!Number.isFinite(at) || (marks.observedSince ?? 0) > at || (marks.changedAt(ref) ?? 0) > at)
    throw new BridgeError(STALE_READ, 409, { notDispatched: true });
}

/** The one refusal a sealed write gets when its document's mark moved after the plan. */
export const PLAN_CHANGED = "Plan changed (documentMark): Revit changed this document after the plan; plan the current Work again.";

/**
 * A sealed write rests on the mark its plan sealed. Waits for events already received but still
 * being applied (the tail awaits `bridge.list`), so a received change cannot hide behind the cache.
 * Ceiling: a change Revit has not yet reported to the host is invisible here.
 */
export async function assertSealed(
  marks: DocumentMarks,
  ref: DocumentRef,
  sealed: { observedSince: number | null; changedAt: number | null },
): Promise<void> {
  await marks.settled?.();
  if ((marks.observedSince ?? null) !== sealed.observedSince || marks.changedAt(ref) !== sealed.changedAt)
    throw new BridgeError(PLAN_CHANGED, 409, { notDispatched: true });
}

const held = new WeakMap<RevitBridge["Service"], DocumentMarks>();

/**
 * One holder per bridge, fed by its tap: the Reading observer and every apply share it. `session` is whichever id a Target names: the marks
 * are recorded under both the broker session id and the pe-revit session id the payload reported.
 */
export function documentMarks(bridge?: RevitBridge["Service"]): DocumentMarks {
  if (!bridge) return NO_MARKS;
  const known = held.get(bridge);
  if (known) return known;
  const marks = new Map<string, Map<string, number>>();
  const listeners = new Set<() => void>();
  let tail = Promise.resolve();
  bridge.subscribe((event) => {
    const atMs = Date.now();
    tail = tail
      .then(async () => {
        // effect-edge: island, phase 5
        const sessions = await Effect.runPromise(bridge.list);
        const ids = (session: (typeof sessions)[number]) =>
          [session.sessionId, session.sdkSessionId].filter((id): id is string => !!id);
        const alive = new Set(sessions.flatMap(ids));
        let changed = false;
        for (const session of marks.keys())
          if (!alive.has(session)) changed = marks.delete(session) || changed;
        const current = sessions.find((session) => session.sessionId === event.sessionId);
        const openIds: unknown =
          event.kind === "disconnected"
            ? [""]
            : event.kind === "event" && event.eventName === "document-changed" && event.payloadJson
              ? (JSON.parse(event.payloadJson) as { changedOpenIds?: unknown }).changedOpenIds
              : [];
        if (current && Array.isArray(openIds) && openIds.length) {
          for (const session of ids(current)) {
            const documents = marks.get(session) ?? new Map<string, number>();
            for (const openId of openIds) documents.set(String(openId), atMs);
            marks.set(session, documents);
          }
          changed = true;
        }
        if (changed) for (const listener of listeners) listener();
      })
      .catch((error) => {
        console.error("document-marks: asynchronous operation failed", error);
        return undefined;
      });
  });

  const holder: DocumentMarks = {
    observedSince: Date.now(),
    changedAt: (ref) =>
      Math.max(
        marks.get(ref.session)?.get(ref.openId) ?? 0,
        marks.get(ref.session)?.get("") ?? 0,
      ) || null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    settled: () => tail,
  };
  held.set(bridge, holder);
  return holder;
}
