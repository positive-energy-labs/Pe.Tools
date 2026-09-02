import {
  threadSnapshot,
  toWireEvent,
  type PeaRuntimeHandle,
  type ThreadWireEvent,
} from "@pe/runtime/pea";
import { closeLedger, makeLedger } from "./ledger.ts";

/** Same bound the browser hydrated with before the ledger; the snapshot carries at most this many rows. */
const THREAD_MESSAGE_LIMIT = 200;
const THREAD_LEDGER_CAPACITY = 500;

/**
 * One `thread:<id>` ledger per materialized web session: the host subscribes to the session bus
 * itself (the vendor SSE handler uses the same `session.subscribe`), so events are stamped whether
 * or not a browser is attached. Web sessions are thread-bound, so the thread id is fixed at creation.
 */
export function attachThreadLedgers(runtime: PeaRuntimeHandle) {
  runtime.controller.onSessionCreated(
    (session) => {
      const threadId = session.thread.getId();
      if (!threadId) return;
      const ledger = makeLedger<ThreadWireEvent>({
        name: `thread:${threadId}`,
        capacity: THREAD_LEDGER_CAPACITY,
        snapshot: () => threadSnapshot(runtime, session, threadId, THREAD_MESSAGE_LIMIT),
      });
      session.subscribe((event) => void ledger.emit(toWireEvent(event)));
    },
    { blocking: true },
  );
  runtime.controller.onSessionDeleted((session) => {
    const threadId = session.thread.getId();
    if (threadId) closeLedger(`thread:${threadId}`);
  });
}
