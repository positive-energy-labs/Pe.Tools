import type { HostInputContext } from "./input-context.ts";
import type { Caller, Pointer, Pointers } from "@pe/agent-contracts";

/**
 * The thread service's pointer surface (ADR 0030 rule 10), injected into the call route. Thread
 * meta.json is the one owner (harness/threads.ts); this is only the port the pe-routes layer binds
 * once its thread service exists, so the sibling call-route layer holds no second list.
 */
export interface ThreadPointers {
  read(threadId: string): Pointers;
  point(threadId: string, input: Omit<Pointer, "id" | "at">): Pointers;
  dismiss(threadId: string, id: string): Pointers;
}
export function threadPointerPort(inputs?: HostInputContext["Service"]) {
  const writable = () => { const denied = inputs?.check({ kind: "recording", verb: "write-metadata" }); if (denied) throw denied; };
  let bound: ThreadPointers | null = null;
  const owner = () => {
    if (!bound) throw Error("Thread pointers are unavailable until the thread store has loaded.");
    return bound;
  };
  return {
    bind: (threads: ThreadPointers) => void (bound = threads),
    read: (threadId: string) => owner().read(threadId),
    point: (threadId: string, input: Omit<Pointer, "id" | "at">) => { writable(); return owner().point(threadId, input); },
    dismiss: (threadId: string, id: string) => { writable(); return owner().dismiss(threadId, id); },
  } satisfies ThreadPointers & { bind(threads: ThreadPointers): void };
}
export type ThreadPointerPort = ReturnType<typeof threadPointerPort>;

/** Pea points in its own thread only; a person names the thread they are looking at. */
export function pointerThread(caller: Caller, named: string | undefined): string {
  if (caller.kind === "pea") return caller.thread;
  if (caller.kind === "human" && named) return named;
  throw Error("Pointers belong to a thread: name it, or call from Pea's thread.");
}
