import { z } from "zod";
import { workFingerprintSchema, type RouteFingerprint } from "./route-kernel-admission.ts";
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
import type { ActionReceipt } from "./action-receipts.ts";

declare const journalCommandId: unique symbol;
/** The existing journal command id, validated by the host adapter; no new wire identity. */
export type JournalCommandId = JournalCommandHandle["id"] & {
  readonly [journalCommandId]: true;
};

export interface WorkScope {
  readonly route: AdmittedRoute["data"]["key"];
  readonly fingerprint: RouteFingerprint;
  /** Work edge declared by this admitted route. submitWork writes by `key.route`; the owner fences. */
  readonly reading?: string;
  readonly key: WorkKey;
  readonly target: ScopeIdentity["target"];
  readonly subject: IdentityId<IdentityKind> | Many<IdentityId<IdentityKind>> | null;
}

export type Unsubscribe = () => void;
/** Unsubscribe detaches this observer only; it never cancels journal-owned work. */
export interface Observation<A> {
  subscribe(onValue: (value: A) => void, onEnd: () => void): Unsubscribe;
}

/** The host's stored Work as read: its one handle (ADR 0030 rule 9) and value. */
export interface WorkSnapshot {
  readonly handle: import("./command.ts").WorkHandle;
  // Mirrors handle.revision for the existing revision readers; the handle is the identity.
  readonly revision: WorkWriteAck["revision"];
  readonly value: unknown;
}

/** registration-mismatch means the tab runs other route bytes than the host admitted,
 * typically an old tab after a Pod update. Reload the tab; never retry or reopen in place.
 * Every failure variant is terminal: failed -> end, with no later ready or ack. */
export const workFeedFailureSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("registration-mismatch"),
    routeKey: z.string(),
    expected: workFingerprintSchema,
    received: workFingerprintSchema,
  }),
  z.strictObject({
    kind: z.literal("migration-failed"),
    routeKey: z.string(),
    fromVersion: z.number().int().positive(),
    toVersion: z.number().int().positive(),
    step: z.number().int().positive().optional(),
    message: z.string(),
  }),
  z.strictObject({ kind: z.literal("failed"), code: z.string(), message: z.string() }),
]);
export type WorkFeedFailure = z.infer<typeof workFeedFailureSchema>;
export const workFeedFailureMessage = (failure: WorkFeedFailure): string =>
  failure.kind === "registration-mismatch"
    ? "Route bytes differ from the host registration. Reload this tab."
    : failure.message;
export const workAdmissionSchema = z.strictObject({
  routeKey: z.string(),
  fingerprint: workFingerprintSchema,
  reading: z.string().optional(),
});
export type WorkAdmission = z.infer<typeof workAdmissionSchema>;

export type WorkFeedState =
  | { readonly kind: "pending" }
  | {
      readonly kind: "failed";
      readonly failure: WorkFeedFailure;
    }
  | {
      readonly kind: "ready";
      readonly snapshot: WorkSnapshot;
      readonly history: {
        /** Canonical acks for this exact admitted scope, ordered, contiguous,
         * ending at snapshot.revision (or empty when nothing is retained). */
        readonly acks: readonly WorkWriteAck[];
        /** First revision the journal view may reach. Undo never crosses below it.
         * Complete: first revision or last start-fresh boundary. Trimmed/unavailable:
         * first retained revision, or snapshot.revision + 1 when none. */
        readonly from: WorkWriteAck["revision"];
      };
    }
  | { readonly kind: "ack"; readonly ack: WorkWriteAck }
  | {
      readonly kind: "gap";
      /** First missing revision, inclusive. */
      readonly from: WorkWriteAck["revision"];
      /** Next available revision, exclusive. Recover the missing interval before applying it. */
      readonly to: WorkWriteAck["revision"];
    };

declare const receiptCursor: unique symbol;
/** Monotonic within one observation; never compare cursors across observations. */
export type ReceiptCursor = number & { readonly [receiptCursor]: true };

/** Receipts are host-authored ActionReceipts, never derived from a submission result in the browser.
 * One receipt changes state over time (waiting -> running -> terminal). Each change is a new emission
 * with a higher cursor. The consumer keys rows by receipt.id; the higher cursor wins. */
export type ReceiptFeedState =
  | { readonly kind: "pending" }
  | { readonly kind: "failed"; readonly failure: WorkFeedFailure }
  | {
      readonly kind: "ready";
      readonly receipts: {
        /** Latest state of each retained receipt in this scope, ordered by cursor, through `through`. */
        readonly rows: readonly ActionReceipt[];
        /** First cursor still retained. Barriers and Timeline never claim completeness below it. */
        readonly from: ReceiptCursor;
        /** Cursor of the last emission the rows include. Live emissions are strictly after it. */
        readonly through: ReceiptCursor;
      };
    }
  | { readonly kind: "receipt"; readonly cursor: ReceiptCursor; readonly receipt: ActionReceipt }
  | {
      readonly kind: "gap";
      /** First missing cursor, inclusive. */
      readonly from: ReceiptCursor;
      /** Next available cursor, exclusive. */
      readonly to: ReceiptCursor;
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
   * in revision order. Acks at or below snapshot.revision arrive via ready.history,
   * never as ack events. The host acquires the bounded contiguous history and snapshot
   * consistently; every ready after a gap replaces the journal view, never Work values. If the first ack
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
  /** Durable receipt observation for one admitted scope: the ActionJournal's read surface.
   * Membership: every receipt whose execution target is scope.target, and every receipt whose
   * basis or consumes names scope.key. Same ordering law as open(): subscribe BEFORE acquiring
   * ready, buffer across that boundary, drop emissions with cursor <= ready.receipts.through,
   * emit gap on a cursor jump, and after a gap MAY emit pending then a replacing ready.
   * Retention (ADR 0029 rule 15): ready is bounded by count and bytes, trimming raises `from`,
   * and a non-terminal receipt (waiting, running, unknown) is never trimmed. Consumers use rows
   * for native barriers, Reject attribution, Timeline and reading invalidation (receipt.effects);
   * they never infer a receipt or a dirty set from command input. Unsubscribe releases
   * observation only, never journal-owned commands. failed is terminal. */
  receipts(scope: WorkScope): Observation<ReceiptFeedState>;
  /** Semantic and native commands that reach Revit use submit; kind: work verbs
   * use submitWork, preserving the Work store's separate durable ownership. */
  submit(command: ActionAdmission): JournalSubmission;
  /** Reconcile a departed mount by its original command id. Retention is bounded per
   * ADR 0029 rule 15; an evicted id returns a rejected result with failure `expired`.
   * Pending means still journal-owned, never permission to resubmit or invent an ack. */
  accepted(id: JournalCommandId): AcceptedResult;
}
