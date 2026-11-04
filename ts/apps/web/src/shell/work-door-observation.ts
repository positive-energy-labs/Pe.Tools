import { isHistoryMetaRefusalCode, workWriteAckSchema } from "@pe/agent-contracts";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";
/** One execution, replayed to observers. Departure releases observation, never the write. */
export function completion<A>(pending: A, execute: () => Promise<A>): Observation<A> {
  let value = pending;
  let settled = false;
  const listeners = new Map<(value: A) => void, () => void>();
  void Promise.resolve()
    .then(execute)
    .then((next) => {
      value = next;
      settled = true;
      for (const [deliver, end] of listeners) {
        deliver(value);
        end();
      }
      listeners.clear();
    });
  return {
    subscribe(deliver, end) {
      deliver(value);
      if (settled) end();
      else listeners.set(deliver, end);
      return () => {
        listeners.delete(deliver);
      };
    },
  };
}
export function workOutcome(
  result: import("@pe/agent-contracts").RouteStateWriteResult,
): WorkWriteOutcome {
  if (result.ok) return { kind: "accepted", ack: workWriteAckSchema.parse(result.write) };
  const refusal =
    "agentHint" in result ? { ...result, error: result.agentHint, hint: result.agentHint } : result;
  if (refusal.code === "stale_revision") {
    if (refusal.revision === undefined) throw Error("Stale Work refusal omitted current revision");
    return {
      kind: "refused",
      refusal: {
        kind: "refused",
        code: "stale_revision",
        error: refusal.error,
        hint: refusal.hint,
        revision: refusal.revision,
      },
    };
  }
  if (isHistoryMetaRefusalCode(refusal.code))
    return {
      kind: "refused",
      refusal: { kind: "refused", code: refusal.code, error: refusal.error, hint: refusal.hint },
    };
  return { kind: "refused", refusal: { ...refusal, code: undefined } };
}
export const failedWrite = (error: unknown): WorkWriteOutcome => ({
  kind: "refused",
  refusal: {
    kind: "error",
    error: String(error),
    hint: "Reconcile Work before retrying",
  },
});

// TODO: COMMON 15: completion() strands observers on rejection; settleWork cannot recover a terminal the door never emits.
export function settleWork(
  write: Observation<WorkWriteOutcome> | { kind: "refused"; reason: "describe-threw" },
): Promise<WorkWriteOutcome> {
  if ("kind" in write)
    return Promise.resolve({
      kind: "refused",
      refusal: {
        kind: "error",
        error: "Could not name this edit",
        hint: "Retry the current input",
      },
    });
  return new Promise((resolve) => {
    write.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    );
  });
}
