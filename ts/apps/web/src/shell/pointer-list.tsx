import { useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import { RegistryContext } from "@effect/atom-react";
import { cite, clearCitation, type SubjectReference } from "@pe/kit/lang/attention";
import type { Pointer } from "../../../../packages/agent-contracts/src/pointers.ts";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";
import { callOp } from "../host/catalog-client";

/** ponytail: polled, ceiling one host read per 2 s per open route; upgrade to a host feed if lists grow. */
const POLL_MS = 2000;

/**
 * "Pea is pointing at" (ADR 0030 rule 10): this thread's pointers on this route, until dismissed.
 * A body cites them through the same host-local read Pea writes with; it never writes the page's
 * selection, attention fields, URL or camera. The person-facing list was retired unmounted
 * (2026-11-11): a person's verb on a subject is a finding (`FindingVerb`), and dismissal is Pea's.
 */
/*
 * One read of the host's list per thread, shared by every body's highlight. The host thread meta stays the only owner; this is its last answer.
 */
const reads = new Map<
  string,
  { pointers: readonly Pointer[]; listeners: Set<() => void>; stop: () => void }
>();
const EMPTY: readonly Pointer[] = [];
function publish(thread: string, pointers: readonly Pointer[]) {
  const read = reads.get(thread);
  if (!read) return;
  read.pointers = pointers;
  read.listeners.forEach((notify) => notify());
}
function subscribe(thread: string, notify: () => void) {
  let read = reads.get(thread);
  if (!read) {
    const control = new AbortController();
    const fetch = () =>
      void callOp({ signal: control.signal }, "pointers.list", { thread }).then(
        (list) => publish(thread, list.pointers),
        () => {},
      );
    const timer = setInterval(fetch, POLL_MS);
    read = {
      pointers: EMPTY,
      listeners: new Set(),
      stop: () => (control.abort(), clearInterval(timer)),
    };
    reads.set(thread, read);
    fetch();
  }
  read.listeners.add(notify);
  return () => {
    read.listeners.delete(notify);
    if (read.listeners.size) return;
    read.stop();
    reads.delete(thread);
  };
}
/** This thread's pointers on `route`, read through the host-local op Pea writes with. */
function usePointers(route: string) {
  const thread = useContext(WorkbenchContext)?.currentThreadId ?? "";
  const listen = useCallback(
    (notify: () => void) => (thread ? subscribe(thread, notify) : () => {}),
    [thread],
  );
  const all = useSyncExternalStore(listen, () => reads.get(thread)?.pointers ?? EMPTY);
  return { pointers: all.filter((p) => p.route === route) };
}

/**
 * The highlight, mounted INSIDE the route's AttentionRoot: the route maps each pointer's target to
 * its own refs and this cites them (focus null). It writes only the citation atom, never selection,
 * the URL or the camera; dismissal, a thread change or unmount clears it.
 */
export function PointerCite({
  route,
  refs,
}: {
  route: string;
  refs: (target: Pointer["target"]) => readonly SubjectReference[];
}) {
  const registry = useContext(RegistryContext);
  const { pointers } = usePointers(route);
  const owner = `pointers:${route}`;
  const cited = pointers.flatMap((pointer) => {
    try {
      return refs(pointer.target);
    } catch {
      return []; // A place that does not read as this route's codec text highlights nothing.
    }
  });
  const key = JSON.stringify(cited.map((ref) => [ref.doc, ref.key]));
  useEffect(() => {
    if (cited.length)
      cite(registry, {
        owner,
        focus: null,
        refs: cited.map((ref, i) => ({ ...ref, number: i + 1 })),
      });
    else clearCitation(registry, owner);
    return () => clearCitation(registry, owner);
    // `key` is the cited refs' identity; the array itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, owner, key]);
  return null;
}
