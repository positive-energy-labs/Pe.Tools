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

export type WorkFeedState =
  | { readonly kind: "pending" }
  | { readonly kind: "failed"; readonly failure: { readonly code: string; readonly message: string } }
  | { readonly kind: "ready"; readonly snapshot: WorkSnapshot }
  | { readonly kind: "ack"; readonly ack: WorkWriteAck }
  | {
      readonly kind: "gap";
      /** First missing revision, inclusive. */
      readonly from: WorkWriteAck["revision"];
      /** Next available revision, exclusive. Recover the missing interval before applying it. */
      readonly to: WorkWriteAck["revision"];
    };

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
  readonly lifetime: "subscription";
  /** Subscribe to acks BEFORE acquiring the snapshot and buffer across that boundary.
   * After ready{snapshot}, emit buffered and later acks with revision > snapshot.revision
   * in revision order; drop those with revision <= snapshot.revision. If the first ack
   * after the snapshot skips revisions, emit gap{from: snapshot.revision + 1, to: ack.revision}.
   * No ack between subscribe and snapshot may be lost or reordered. Later revision jumps
   * likewise emit a gap before the next available ack, with from the first missing revision.
   *
   * Legal state machine: pending -> (ready | failed); ready -> (ack | gap)*;
   * gap -> (pending -> ready | failed) | ack; failed -> end.
   * After a gap, the implementation MAY emit pending then a fresh ready{snapshot} within
   * the same observation, without resubscribing; the consumer resets to that snapshot.
   * The ordering contract applies to each snapshot. A failed state is terminal: onEnd
   * follows and no further state is emitted. Unsubscribe releases observation only,
   * never journal-owned commands.
   */
  open(scope: WorkScope): Observation<WorkFeedState>;
  submit(command: ActionAdmission): JournalSubmission;
  /** Reconcile a departed mount by its original command id. Retention is bounded per
   * ADR 0029 rule 15; an evicted id returns a rejected result with failure `expired`.
   * Pending means still journal-owned, never permission to resubmit or invent an ack. */
  accepted(id: JournalCommandId): AcceptedResult;
}
