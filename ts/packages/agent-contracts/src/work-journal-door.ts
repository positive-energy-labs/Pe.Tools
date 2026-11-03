import type { CommandRefusal } from "./command.ts";
import type { AdmittedRoute } from "./route-kernel-admission.ts";
import type { JournalCommandHandle } from "./route-kernel-environment.ts";
import type { IdentityId, IdentityKind, Many, ScopeIdentity } from "./route-kernel-page.ts";
import type { WorkKey, WorkWriteAck } from "./route-state.ts";
import type { ActionAdmission } from "./semantic-actions.ts";

declare const journalCommandId: unique symbol;
/** The existing journal command id, validated by the host adapter; no new wire identity. */
export type JournalCommandId = JournalCommandHandle["id"] & {
  readonly [journalCommandId]: true;
};

export interface WorkScope {
  readonly route: AdmittedRoute["data"]["key"];
  readonly key: WorkKey;
  readonly target: ScopeIdentity["target"];
  readonly subject: IdentityId<IdentityKind> | Many<IdentityId<IdentityKind>> | null;
}

export type Unsubscribe = () => void;
/** Unsubscribe detaches this observer only; it never cancels journal-owned work. */
export interface Observation<A> {
  subscribe(onValue: (value: A) => void, onEnd: () => void): Unsubscribe;
}

export interface WorkSnapshot {
  readonly key: WorkKey;
  readonly revision: WorkWriteAck["revision"];
  readonly value: unknown;
}

export type WorkFeedFrame =
  | { readonly kind: "ack"; readonly ack: WorkWriteAck }
  | {
      readonly kind: "gap";
      /** Last delivered revision, exclusive. */
      readonly from: WorkWriteAck["revision"];
      /** Next available revision, exclusive. Recover the missing interval before applying it. */
      readonly to: WorkWriteAck["revision"];
    };

/** Acquisition captures the initial snapshot before frames. Subscription must replay every
 * subsequent accepted revision in order, including writes between open and subscribe.
 * A revision jump emits a gap, never a silently skipped delta. Consumers drop duplicate
 * revisions. Closing the subscription releases observation, never a command's lifetime. */
export interface WorkFeed {
  readonly lifetime: "subscription";
  readonly snapshot: WorkSnapshot;
  readonly frames: Observation<WorkFeedFrame>;
}

/** ADR 0029 rule 10: transport cancellation alone cannot establish a native outcome. */
export type NativeOutcome =
  | "never-dispatched"
  | "native-cancel-requested"
  | "native-acknowledged"
  | "committed"
  | "unknown-until-reconciled";

export type AcceptedResult =
  | { readonly kind: "accepted"; readonly ack: WorkWriteAck; readonly receiptId: string }
  | {
      readonly kind: "accepted-native";
      readonly receiptId: string;
      readonly outcome: NativeOutcome;
    }
  | {
      readonly kind: "rejected";
      readonly failure: CommandRefusal["kind"] | "failed" | "unavailable";
      readonly problem: string;
    }
  | { readonly kind: "rejected"; readonly failure: "expired"; readonly problem: string }
  | { readonly kind: "pending" };

export interface JournalSubmission {
  readonly lifetime: "command";
  readonly handle: JournalCommandHandle & { readonly id: JournalCommandId };
  /** Journal-owned observation replays current status, then resolves once with a non-pending
   * result and ends. Observer departure never cancels or discards the accepted result. */
  readonly accepted: Observation<AcceptedResult>;
}

export interface WorkJournalDoor {
  open(scope: WorkScope): WorkFeed;
  submit(command: ActionAdmission): JournalSubmission;
  /** Reconcile a departed mount by its original command id. Retention is bounded per
   * ADR 0029 rule 15; an evicted id returns a rejected result with failure `expired`.
   * Pending means still journal-owned, never permission to resubmit or invent an ack. */
  accepted(id: JournalCommandId): AcceptedResult;
}
