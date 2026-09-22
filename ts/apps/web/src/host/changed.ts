/**
 * The per-document change mark. Revit's `document-changed` event names the documents that changed
 * (`changedOpenIds`); this holds, per exact open document, when the last one arrived. Freshness is
 * that mark against a Reading's own taken-at — never a timer, never an age.
 */
import { useSyncExternalStore } from "react";
import { subscribeHostEvents } from "#/readings";

/** The exact open document a mark belongs to: the same pair a Target names. */
export interface DocumentRef {
  readonly session: string;
  readonly openId: string;
}

type WorldFrame = {
  readonly kind: string;
  readonly sessionId?: string;
  readonly eventName?: string;
  readonly payloadJson?: string | null;
  readonly atMs?: number;
};

const keyOf = (ref: DocumentRef) => `${ref.session}:${ref.openId}`;

const marks = new Map<string, number>();
const listeners = new Set<() => void>();

const announce = () => {
  for (const listener of listeners) listener();
};

/** Records a change on each named document. Exported for the host feed and for tests. */
export function markChanged(sessionId: string, openIds: readonly string[], atMs: number) {
  if (openIds.length === 0) return;
  for (const openId of openIds) marks.set(keyOf({ session: sessionId, openId }), atMs);
  announce();
}

/** Forgets every mark; a fresh world (a reconnect, a test) starts unmarked. */
export function forgetMarks() {
  if (marks.size === 0) return;
  marks.clear();
  announce();
}

const ingest = (frame: WorldFrame) => {
  if (frame.kind !== "event" || frame.eventName !== "document-changed") return;
  const payload = frame.payloadJson;
  if (!payload || !frame.sessionId) return;
  const changed = (JSON.parse(payload) as { changedOpenIds?: unknown }).changedOpenIds;
  if (!Array.isArray(changed)) return;
  markChanged(frame.sessionId, changed.map(String), frame.atMs ?? Date.now());
};

/** One world subscription for the whole tab, opened on the first reader and never churned. */
let release: (() => void) | null = null;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  release ??= subscribeHostEvents<WorldFrame>(ingest);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      release?.();
      release = null;
    }
  };
};

/** When this document last changed in Revit, or null while it has never been marked. */
export const changedAt = (ref: DocumentRef | null): number | null =>
  (ref && marks.get(keyOf(ref))) ?? null;

/** A Reading is changed when its document's last change is later than when the Reading was taken. */
export const isChanged = (mark: number | null, takenAt: string | null | undefined): boolean =>
  mark !== null && (!takenAt || mark > Date.parse(takenAt));

/** The document's change mark, live. */
export function useChangeMark(ref: DocumentRef | null): number | null {
  const key = ref ? keyOf(ref) : null;
  return useSyncExternalStore(
    subscribe,
    () => (key === null ? null : (marks.get(key) ?? null)),
    () => null,
  );
}
