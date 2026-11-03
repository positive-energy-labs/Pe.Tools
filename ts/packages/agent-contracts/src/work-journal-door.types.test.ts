import { expectTypeOf, it } from "vite-plus/test";
import type { ActionAdmission } from "./semantic-actions.ts";
import type { JournalCommandHandle } from "./route-kernel-environment.ts";
import type {
  AcceptedResult,
  JournalCommandId,
  JournalSubmission,
  NativeOutcome,
  Observation,
  WorkFeed,
  WorkFeedFrame,
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
) {
  // @ts-expect-error Submission must carry accepted observation, not a bare handle.
  const bare: JournalSubmission = handle;
  // @ts-expect-error The submit port cannot return a bare command handle either.
  const submit: WorkJournalDoor["submit"] = () => handle;
  // @ts-expect-error A patch without an accepted revision and provenance is not a frame.
  const unordered: WorkFeedFrame = { kind: "patch", path: ["amount"], value: 7 };
  // @ts-expect-error Reconciliation requires a journal-issued id, not an arbitrary string.
  door.accepted("arbitrary");
  // @ts-expect-error A raw S0 handle id must first cross the host adapter's validation.
  door.accepted(handle.id);
  // @ts-expect-error Transport disconnect is not one of the five native outcomes.
  const cancelled: NativeOutcome = "cancelled";
  const submission = door.submit(command);
  door.accepted(submission.handle.id);
  const feed = door.open(scope);
  feed.frames.subscribe(
    () => {},
    () => {},
  )();
  return [bare, submit, unordered, cancelled];
}

it("exposes inhabited ports and only the three journal doors", () => {
  expectTypeOf<NeverMembers<WorkJournalDoor>>().toBeNever();
  expectTypeOf<NeverMembers<WorkScope>>().toBeNever();
  expectTypeOf<NeverMembers<WorkFeed>>().toBeNever();
  expectTypeOf<NeverMembers<WorkSnapshot>>().toBeNever();
  expectTypeOf<NeverMembers<WorkFeedFrame>>().toBeNever();
  expectTypeOf<NeverMembers<JournalSubmission>>().toBeNever();
  expectTypeOf<NeverMembers<AcceptedResult>>().toBeNever();
  expectTypeOf<NeverMembers<Observation<AcceptedResult>>>().toBeNever();
  expectTypeOf<keyof WorkJournalDoor>().toEqualTypeOf<"open" | "submit" | "accepted">();
  expectTypeOf<Parameters<WorkJournalDoor["open"]>>().toEqualTypeOf<[WorkScope]>();
  expectTypeOf<Parameters<WorkJournalDoor["submit"]>>().toEqualTypeOf<[ActionAdmission]>();
  expectTypeOf<Parameters<WorkJournalDoor["accepted"]>>().toEqualTypeOf<[JournalCommandId]>();
  expectTypeOf<ReturnType<WorkJournalDoor["open"]>>().toEqualTypeOf<WorkFeed>();
  expectTypeOf<ReturnType<WorkJournalDoor["submit"]>>().toEqualTypeOf<JournalSubmission>();
  expectTypeOf<ReturnType<WorkJournalDoor["accepted"]>>().toEqualTypeOf<AcceptedResult>();
  expectTypeOf<WorkFeed["snapshot"]>().toEqualTypeOf<WorkSnapshot>();
  expectTypeOf<WorkFeed["frames"]>().toEqualTypeOf<Observation<WorkFeedFrame>>();
  expectTypeOf<JournalSubmission["accepted"]>().toEqualTypeOf<Observation<AcceptedResult>>();
  expectTypeOf<JournalSubmission["handle"]>().toExtend<JournalCommandHandle>();
  expectTypeOf<Extract<AcceptedResult, { failure: "expired" }>["problem"]>().toBeString();
});
