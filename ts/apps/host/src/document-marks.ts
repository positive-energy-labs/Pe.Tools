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
  /** `${session}:${openId}` for a named document; `${session}:` for a whole blind session. */
  const marks = new Map<string, number>();
  const listeners = new Set<() => void>();
  const announce = () => {
    for (const listener of listeners) listener();
  };
  const write = (sessions: readonly string[], openIds: readonly string[], atMs: number) => {
    for (const session of sessions)
      for (const openId of openIds) marks.set(`${session}:${openId}`, atMs);
    announce();
  };
  /** Both ids this session answers to; a Target names either one. */
  const sessionIds = (sessionId: string) =>
    Effect.runPromise(Effect.suspend(() => bridge.snapshot(sessionId))).then(
      (view) =>
        view.sdkSessionId && view.sdkSessionId !== sessionId
          ? [sessionId, view.sdkSessionId]
          : [sessionId],
      () => [sessionId],
    );

  bridge.subscribe((event) => {
    if (event.kind === "disconnected") {
      // Blind from here: every document of this session is changed until it is read again.
      void sessionIds(event.sessionId).then((ids) => write(ids, [""], Date.now()));
      return;
    }
    if (event.kind !== "event" || event.eventName !== "document-changed") return;
    const payload = event.payloadJson;
    if (!payload) return;
    const changed = (JSON.parse(payload) as { changedOpenIds?: unknown }).changedOpenIds;
    if (!Array.isArray(changed) || changed.length === 0) return;
    const atMs = Date.now();
    void sessionIds(event.sessionId).then((ids) => write(ids, changed.map(String), atMs));
  });

  return {
    changedAt: (ref) =>
      Math.max(marks.get(`${ref.session}:${ref.openId}`) ?? 0, marks.get(`${ref.session}:`) ?? 0) ||
      null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
