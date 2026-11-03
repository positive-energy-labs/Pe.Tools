import { expectTypeOf, it } from "vite-plus/test";
import type { ActionAdmission } from "./semantic-actions.ts";
import type { JournalCommandHandle } from "./route-kernel-environment.ts";
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
) {
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
  // @ts-expect-error A failed frame cannot carry an ack.
  const failedAck: WorkFeedState = { kind: "failed", failure: { code: "read", message: "failed" }, ack };
  const synchronous = { lifetime: "subscription" as const, snapshot, frames: feed };
  // @ts-expect-error Open must return an observation, not the old synchronous feed.
  const open: WorkJournalDoor["open"] = () => synchronous;
  return [bare, submit, unordered, cancelled, ackSnapshot, failedAck, open];
}

it("exposes inhabited ports and only the three journal doors", () => {
  expectTypeOf<NeverMembers<WorkJournalDoor>>().toBeNever();
  expectTypeOf<NeverMembers<WorkScope>>().toBeNever();
  expectTypeOf<NeverMembers<WorkSnapshot>>().toBeNever();
  expectTypeOf<NeverMembers<WorkFeedState>>().toBeNever();
  expectTypeOf<NeverMembers<JournalSubmission>>().toBeNever();
  expectTypeOf<NeverMembers<AcceptedResult>>().toBeNever();
  expectTypeOf<NeverMembers<Observation<AcceptedResult>>>().toBeNever();
  expectTypeOf<keyof WorkJournalDoor>().toEqualTypeOf<"lifetime" | "open" | "submit" | "accepted">();
  expectTypeOf<Parameters<WorkJournalDoor["open"]>>().toEqualTypeOf<[WorkScope]>();
  expectTypeOf<Parameters<WorkJournalDoor["submit"]>>().toEqualTypeOf<[ActionAdmission]>();
  expectTypeOf<Parameters<WorkJournalDoor["accepted"]>>().toEqualTypeOf<[JournalCommandId]>();
  expectTypeOf<ReturnType<WorkJournalDoor["open"]>>().toEqualTypeOf<Observation<WorkFeedState>>();
  expectTypeOf<ReturnType<WorkJournalDoor["submit"]>>().toEqualTypeOf<JournalSubmission>();
  expectTypeOf<ReturnType<WorkJournalDoor["accepted"]>>().toEqualTypeOf<AcceptedResult>();
  expectTypeOf<WorkJournalDoor["lifetime"]>().toEqualTypeOf<"subscription">();
  expectTypeOf<Extract<WorkFeedState, { kind: "ready" }>["snapshot"]>().toEqualTypeOf<WorkSnapshot>();
  expectTypeOf<JournalSubmission["accepted"]>().toEqualTypeOf<Observation<AcceptedResult>>();
  expectTypeOf<JournalSubmission["handle"]>().toExtend<JournalCommandHandle>();
  expectTypeOf<Extract<AcceptedResult, { failure: "expired" }>["problem"]>().toBeString();
});

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
