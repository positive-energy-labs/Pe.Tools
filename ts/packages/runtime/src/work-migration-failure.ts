import type { WorkFeedFailure } from "../../agent-contracts/src/work-journal-door.ts";

/** Internal exception carries the terminal typed feed reason without altering saved bytes. */
export class WorkMigrationFailure extends Error {
  constructor(readonly failure: Extract<WorkFeedFailure, { kind: "migration-failed" }>) {
    super(failure.message);
  }
}
