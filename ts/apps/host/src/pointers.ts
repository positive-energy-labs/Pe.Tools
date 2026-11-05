import { randomUUID } from "node:crypto";
import type { Pointer, Pointers } from "../../../packages/agent-contracts/src/pointers.ts";
import type { Caller } from "@pe/agent-contracts";

/*
 * "Pea is pointing at" (ADR 0030 rule 10): one list per thread, newest last, kept until dismissed.
 * ponytail: held in host memory, so a host restart clears every list. Upgrade path: a `pointers`
 * field in the thread's meta.json beside `workContext` (harness/thread-store.ts), the census'
 * only persistent per-thread record. Not RouteViewStore: attention moves the page; a pointer never does.
 */
const lists = new Map<string, Pointer[]>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((notify) => notify());

/** Pea points in its own thread only; a person names the thread they are looking at. */
export function pointerThread(caller: Caller, named: string | undefined): string {
  if (caller.kind === "pea") return caller.thread;
  if (caller.kind === "human" && named) return named;
  throw Error("Pointers belong to a thread: name it, or call from Pea's thread.");
}
export const readPointers = (threadId: string): Pointers => ({
  threadId,
  pointers: lists.get(threadId) ?? [],
});
export function point(threadId: string, input: Omit<Pointer, "id" | "at">): Pointers {
  lists.set(threadId, [
    ...(lists.get(threadId) ?? []),
    { ...input, id: randomUUID(), at: new Date().toISOString() },
  ]);
  changed();
  return readPointers(threadId);
}
export function dismiss(threadId: string, id: string): Pointers {
  lists.set(
    threadId,
    (lists.get(threadId) ?? []).filter((pointer) => pointer.id !== id),
  );
  changed();
  return readPointers(threadId);
}
export function subscribePointers(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}
