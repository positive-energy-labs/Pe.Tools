import type { CommandRefusal } from "./command.ts";
import type { AdmittedRoute } from "./route-kernel-admission.ts";
import type { JournalCommandHandle } from "./route-kernel-environment.ts";
import type {
  IdentityId,
  IdentityKind,
  InvocationBasis,
  Many,
  ScopeIdentity,
} from "./route-kernel-page.ts";
import type { RouteStateWriteResult, WorkKey, WorkWrite, WorkWriteAck } from "./route-state.ts";
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
  | {
      readonly kind: "failed";
      readonly failure: { readonly code: string; readonly message: string };
    }
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
      readonly outcome: "committed";
      /** Authoritative catalog output, decoded by the mount before lands. Only committed
       * outcomes may land; absent output is decoded as undefined, never a guessed result. */
      readonly result?: unknown;
    }
  | {
      readonly kind: "accepted-native";
      readonly receiptId: string;
      readonly outcome: Exclude<NativeOutcome, "committed">;
    }
  | {
      readonly kind: "rejected";
      readonly failure: CommandRefusal["kind"] | "failed" | "unavailable";
      readonly problem: string;
    }
  | { readonly kind: "rejected"; readonly failure: "expired"; readonly problem: string }
  | { readonly kind: "pending" };

export interface JournalSubmission {
  /** Catalog entry captured by the submission, never inferred from a later Page. */
  readonly key: ActionAdmission["key"];
  readonly lifetime: "command";
  readonly handle: JournalCommandHandle & { readonly id: JournalCommandId };
  /** Journal-owned observation replays current status, then resolves once with a non-pending
   * result and ends. Observer departure never cancels or discards the accepted result. */
  readonly accepted: Observation<AcceptedResult>;
}

type WorkWriteFailure = Extract<RouteStateWriteResult, { ok: false }>;
type WorkWriteRefusalData<T extends WorkWriteFailure> = T extends WorkWriteFailure
  ? Omit<T, "ok" | "agentHint" | "code"> & {
      readonly code?: Exclude<T["code"], "stale_revision">;
      readonly error: string;
      readonly hint: string;
    }
  : never;

/** Mirrors refused route writes as data. Families' agentHint becomes error/hint.
 * A stale expectedRevision always carries the current revision so the caller can rebase. */
export type WorkWriteRefusal =
  | WorkWriteRefusalData<WorkWriteFailure>
  | {
      readonly kind: "refused";
      readonly code: "stale_revision";
      readonly error: string;
      readonly hint: string;
      readonly revision: WorkWriteAck["revision"];
    };

export type WorkWriteOutcome =
  | { readonly kind: "pending" }
  | { readonly kind: "accepted"; readonly ack: WorkWriteAck }
  | { readonly kind: "refused"; readonly refusal: WorkWriteRefusal };

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
  /** TARGET ownership boundary: kind: work verbs use submitWork. The Work store owns
   * revisioned patches and their acks; ActionJournal owns commands that reach Revit
   * and need consent. Work is always open to Pea. Routing Work keystrokes through
   * the journal would impose consent and journal machinery on Work edits.
   * invocation preserves the causal parent (ADR 0029 rule 14). The host stamps
   * authorship from the principal; clients never supply it.
   * A Work write is not a journal command and has no JournalCommandHandle or
   * accepted(id) recovery path. A departed mount recovers acks by revision from
   * open()'s feed. The observation emits pending, then accepted or refused and ends. */
  submitWork(
    scope: WorkScope,
    write: WorkWrite,
    invocation: InvocationBasis,
  ): Observation<WorkWriteOutcome>;
  /** Semantic and native commands that reach Revit use submit; kind: work verbs
   * use submitWork, preserving the Work store's separate durable ownership. */
  submit(command: ActionAdmission): JournalSubmission;
  /** Reconcile a departed mount by its original command id. Retention is bounded per
   * ADR 0029 rule 15; an evicted id returns a rejected result with failure `expired`.
   * Pending means still journal-owned, never permission to resubmit or invent an ack. */
  accepted(id: JournalCommandId): AcceptedResult;
}
