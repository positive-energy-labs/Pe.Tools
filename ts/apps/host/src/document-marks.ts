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
import type { RevitBridge } from "./bridge.ts";

export interface DocumentRef {
  readonly session: string;
  readonly openId: string;
}

export interface DocumentMarks {
  /** When this exact open document last changed in Revit, or null while it never has. */
  readonly changedAt: (ref: DocumentRef) => number | null;
  /** Fires whenever any mark moves. */
  readonly subscribe: (listener: () => void) => () => void;
}

const NO_MARKS: DocumentMarks = { changedAt: () => null, subscribe: () => () => {} };

/**
 * One holder per host, fed by the bridge tap. `session` is whichever id a Target names: the marks
 * are recorded under both the broker session id and the pe-revit session id the payload reported.
 */
export function documentMarks(bridge?: RevitBridge["Service"]): DocumentMarks {
  if (!bridge) return NO_MARKS;
  const marks = new Map<string, Map<string, number>>();
  const listeners = new Set<() => void>();
  let tail = Promise.resolve();
  bridge.subscribe((event) => {
    const atMs = Date.now();
    tail = tail
      .then(async () => {
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
      .catch(() => undefined);
  });

  return {
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
  };
}
