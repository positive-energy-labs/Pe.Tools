import { expectTypeOf, it } from "vite-plus/test";
import type { ActionAdmission } from "./semantic-actions.ts";
import type { JournalCommandHandle } from "./route-kernel-environment.ts";
import type { InvocationBasis } from "./route-kernel-page.ts";
import type { WorkWrite, WorkWriteAck } from "./route-state.ts";
import type {
  AcceptedResult,
  JournalCommandId,
  JournalSubmission,
  NativeOutcome,
  Observation,
  WorkFeedState,
  WorkJournalDoor,
  WorkScope,
  WorkSnapshot,
  WorkWriteOutcome,
  WorkWriteRefusal,
} from "./work-journal-door.ts";

type NeverMembers<T> = {
  [K in keyof T]-?: [T[K]] extends [never] ? K : never;
}[keyof T];

/** Compile-only refusals; this function is never invoked. */
export function doorRefusals(
  door: WorkJournalDoor,
  handle: JournalCommandHandle,
  command: ActionAdmission,
  scope: WorkScope,
  snapshot: WorkSnapshot,
  ack: import("./route-state.ts").WorkWriteAck,
  invocation: InvocationBasis,
) {
  // @ts-expect-error Work submission requires a revision-checked write, not an action.
  door.submitWork(scope, command, invocation);
  // @ts-expect-error Work acceptance cannot carry a journal command handle.
  const workHandle: WorkWriteOutcome = { kind: "accepted", ack, handle };
  // @ts-expect-error A journal handle cannot substitute for the authentic Work ack.
  const handleAck: WorkWriteOutcome = { kind: "accepted", ack: handle };
  const { inverse: _inverse, ...withoutInverse } = ack;
  // @ts-expect-error Accepted Work acks must retain the host's inverse.
  const missingInverse: WorkWriteOutcome = { kind: "accepted", ack: withoutInverse };
  // @ts-expect-error Stale-base refusals must carry the current revision.
  const stale: WorkWriteRefusal = {
    kind: "refused",
    code: "stale_revision",
    error: "stale",
    hint: "rebase",
  };
  // @ts-expect-error Submission must carry accepted observation, not a bare handle.
  const bare: JournalSubmission = handle;
  // @ts-expect-error The submit port cannot return a bare command handle either.
  const submit: WorkJournalDoor["submit"] = () => handle;
  // @ts-expect-error A patch without an accepted revision and provenance is not a frame.
  const unordered: WorkFeedState = { kind: "patch", path: ["amount"], value: 7 };
  // @ts-expect-error Reconciliation requires a journal-issued id, not an arbitrary string.
  door.accepted("arbitrary");
  // @ts-expect-error A raw S0 handle id must first cross the host adapter's validation.
  door.accepted(handle.id);
  // @ts-expect-error Transport disconnect is not one of the five native outcomes.
  const cancelled: NativeOutcome = "cancelled";
  const submission = door.submit(command);
  door.accepted(submission.handle.id);
  const feed = door.open(scope);
  feed.subscribe(
    () => {},
    () => {},
  )();
  // @ts-expect-error An ack frame cannot carry a snapshot.
  const ackSnapshot: WorkFeedState = { kind: "ack", ack, snapshot };
  const failedAck: WorkFeedState = {
    kind: "failed",
    failure: { code: "read", message: "failed" },
    // @ts-expect-error A failed frame cannot carry an ack.
    ack,
  };
  const synchronous = { lifetime: "subscription" as const, snapshot, frames: feed };
  // @ts-expect-error Open must return an observation, not the old synchronous feed.
  const open: WorkJournalDoor["open"] = () => synchronous;
  return [
    bare,
    submit,
    unordered,
    cancelled,
    ackSnapshot,
    failedAck,
    open,
    workHandle,
    handleAck,
    missingInverse,
    stale,
  ];
}

it("exposes inhabited Work and journal ports", () => {
  expectTypeOf<NeverMembers<WorkJournalDoor>>().toBeNever();
  expectTypeOf<NeverMembers<WorkScope>>().toBeNever();
  expectTypeOf<NeverMembers<WorkSnapshot>>().toBeNever();
  expectTypeOf<NeverMembers<WorkFeedState>>().toBeNever();
  expectTypeOf<NeverMembers<JournalSubmission>>().toBeNever();
  expectTypeOf<NeverMembers<AcceptedResult>>().toBeNever();
  expectTypeOf<NeverMembers<Observation<AcceptedResult>>>().toBeNever();
  expectTypeOf<NeverMembers<WorkWriteOutcome>>().toBeNever();
  expectTypeOf<keyof WorkJournalDoor>().toEqualTypeOf<
    "lifetime" | "open" | "submitWork" | "submit" | "accepted"
  >();
  expectTypeOf<Parameters<WorkJournalDoor["submitWork"]>>().toEqualTypeOf<
    [WorkScope, WorkWrite, InvocationBasis]
  >();
  expectTypeOf<ReturnType<WorkJournalDoor["submitWork"]>>().toEqualTypeOf<
    Observation<WorkWriteOutcome>
  >();
  expectTypeOf<
    Extract<WorkWriteOutcome, { kind: "accepted" }>["ack"]
  >().toEqualTypeOf<WorkWriteAck>();
  expectTypeOf<Extract<WorkWriteOutcome, { kind: "accepted" }>["ack"]["inverse"]>().toEqualTypeOf<
    WorkWriteAck["inverse"]
  >();
  expectTypeOf<Parameters<WorkJournalDoor["open"]>>().toEqualTypeOf<[WorkScope]>();
  expectTypeOf<Parameters<WorkJournalDoor["submit"]>>().toEqualTypeOf<[ActionAdmission]>();
  expectTypeOf<Parameters<WorkJournalDoor["accepted"]>>().toEqualTypeOf<[JournalCommandId]>();
  expectTypeOf<ReturnType<WorkJournalDoor["open"]>>().toEqualTypeOf<Observation<WorkFeedState>>();
  expectTypeOf<ReturnType<WorkJournalDoor["submit"]>>().toEqualTypeOf<JournalSubmission>();
  expectTypeOf<ReturnType<WorkJournalDoor["accepted"]>>().toEqualTypeOf<AcceptedResult>();
  expectTypeOf<WorkJournalDoor["lifetime"]>().toEqualTypeOf<"subscription">();
  expectTypeOf<
    Extract<WorkFeedState, { kind: "ready" }>["snapshot"]
  >().toEqualTypeOf<WorkSnapshot>();
  expectTypeOf<JournalSubmission["accepted"]>().toEqualTypeOf<Observation<AcceptedResult>>();
  expectTypeOf<JournalSubmission["handle"]>().toExtend<JournalCommandHandle>();
  expectTypeOf<Extract<AcceptedResult, { failure: "expired" }>["problem"]>().toBeString();
});

/** Compile-only consumer: every Work submission outcome must be handled. */
export function consumeWorkWrite(outcome: WorkWriteOutcome) {
  switch (outcome.kind) {
    case "pending":
    case "accepted":
    case "refused":
      return outcome.kind;
    default:
      expectTypeOf(outcome).toBeNever();
      return outcome satisfies never;
  }
}

/** Compile-only consumer: every acquisition and feed state must be handled. */
export function consumeWorkFeed(state: WorkFeedState) {
  switch (state.kind) {
    case "pending":
    case "failed":
    case "ready":
    case "ack":
    case "gap":
      return state.kind;
    default:
      expectTypeOf(state).toBeNever();
      return state satisfies never;
  }
}
