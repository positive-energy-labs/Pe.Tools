import {
  workFeedFailureMessage,
  workFeedFailureSchema,
  type WorkFeedFailure,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { z } from "zod";
import {
  actionStatusSchema,
  workHandleSchema,
  workKey,
  workWriteAckSchema,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import type {
  WorkJournalDoor,
  WorkFeedState,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { peReadings, type Readings } from "../readings";
import { writeRouteWork } from "../route/host";
import { submitAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type {
  AcceptedResult,
  WorkWriteOutcome,
  JournalCommandId,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import type { CausalParentId } from "../../../../packages/agent-contracts/src/route-kernel-page";

const cursorSchema = z.number().int().nonnegative();
const receiptFeedSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("failed"), failure: workFeedFailureSchema }),
  z.object({
    kind: z.literal("ready"),
    receipts: z.object({
      rows: actionStatusSchema.array(),
      from: cursorSchema,
      through: cursorSchema,
    }),
  }),
  z.object({ kind: z.literal("receipt"), cursor: cursorSchema, receipt: actionStatusSchema }),
  z.object({ kind: z.literal("gap"), from: cursorSchema, to: cursorSchema }),
]);
const snapshotSchema = z.object({
  handle: workHandleSchema,
  revision: z.number().int().nonnegative(),
  doc: z.unknown(),
  history: z.object({ acks: z.array(workWriteAckSchema), from: z.number().int().nonnegative() }),
});
import { completion, workOutcome, failedWrite } from "./work-door-observation";
// The shared Reading transport outlives shell/target remounts in this tab. A registration
// mismatch latches until reload; recreating a client must never retry against other bytes.
const reloadFailures = new WeakMap<Readings, Map<string, WorkFeedFailure>>();
export const browserWorkPorts = { write: writeRouteWork, submit: submitAction };

/** Complete Work and native journal client over the existing host doors. */
export function createWorkFeedClient(
  source: Readings = peReadings,
  ports = browserWorkPorts,
  replayLimit = 256,
): WorkJournalDoor {
  const replay = new Map<string, AcceptedResult>();
  const reload = reloadFailures.get(source) ?? new Map<string, WorkFeedFailure>();
  reloadFailures.set(source, reload);
  const accepted = (id: JournalCommandId): AcceptedResult =>
    replay.get(id) ?? {
      kind: "rejected",
      failure: "expired",
      problem: "Command is outside the replay window",
    };
  return {
    lifetime: "subscription",
    accepted,
    receipts(scope) {
      return {
        subscribe(deliver, end) {
          let closed = false;
          let cursor: number | null = null;
          const request = {
            kind: "receipts" as const,
            scope: { key: scope.key, target: scope.target },
          };
          let stop = () => {};
          stop = source.subscribe(request, (frame) => {
            if (closed || ("stale" in frame && frame.stale)) return;
            if (frame.kind === "failure") {
              deliver({
                kind: "failed",
                failure: frame.failure ?? {
                  kind: "failed",
                  code: "ReceiptFeedFailed",
                  message: frame.error,
                },
              });
              closed = true;
              stop();
              end();
              return;
            }
            if (frame.kind !== "snapshot" && frame.kind !== "event") return;
            // This envelope is authored by the host adapter over ActionJournal, never submit().
            const decoded = receiptFeedSchema.safeParse(frame.value);
            if (!decoded.success) {
              deliver({
                kind: "failed",
                failure: {
                  kind: "failed",
                  code: "InvalidReceiptFeed",
                  message: decoded.error.message,
                },
              });
              closed = true;
              stop();
              end();
              return;
            }
            const state =
              decoded.data as import("../../../../packages/agent-contracts/src/work-journal-door").ReceiptFeedState;
            if (state.kind === "ready") cursor = state.receipts.through;
            if (state.kind === "receipt") {
              if (cursor === null || state.cursor <= cursor) return;
              if (state.cursor !== cursor + 1) {
                deliver({
                  kind: "gap",
                  from: (cursor +
                    1) as import("../../../../packages/agent-contracts/src/work-journal-door").ReceiptCursor,
                  to: state.cursor,
                });
                deliver({ kind: "pending" });
                cursor = null;
                source.dirty(request);
                return;
              }
              cursor = state.cursor;
            }
            deliver(state);
            if (state.kind === "failed") {
              closed = true;
              stop();
              end();
            }
          });
          if (closed) stop();
          return () => {
            closed = true;
            stop();
          };
        },
      };
    },
    submitWork(scope, write, invocation) {
      return completion<WorkWriteOutcome>({ kind: "pending" }, async () => {
        try {
          const outcome = workOutcome(await ports.write(scope.key, write, invocation));
          if (outcome.kind === "accepted" && workKey(outcome.ack.key) !== workKey(scope.key))
            throw Error("Work response belongs to another Work");
          return outcome;
        } catch (error) {
          return failedWrite(error);
        }
      });
    },
    submit(command) {
      const id = command.id as JournalCommandId;
      replay.set(id, { kind: "pending" });
      const observation = completion<AcceptedResult>({ kind: "pending" }, async () => {
        let result: AcceptedResult;
        try {
          const row = await ports.submit(command);
          result =
            row.state === "detached"
              ? { kind: "pending" }
              : row.state === "succeeded"
                ? {
                    kind: "accepted-native",
                    receiptId: row.id,
                    outcome: "committed",
                    result: row.result,
                  }
                : row.state === "unknown"
                  ? {
                      kind: "accepted-native",
                      receiptId: row.id,
                      outcome: "unknown-until-reconciled",
                    }
                  : {
                      kind: "rejected",
                      failure: "failed",
                      problem: "error" in row ? row.error : row.state,
                    };
        } catch (error) {
          result = { kind: "rejected", failure: "unavailable", problem: String(error) };
        }
        replay.set(id, result);
        while (replay.size > replayLimit) {
          const evict = [...replay].find(([, value]) => value.kind !== "pending")?.[0];
          if (!evict) break;
          replay.delete(evict);
        }
        return result;
      });
      return {
        lifetime: "command",
        key: command.key,
        handle: { lifetime: "command", id, causalParent: id as unknown as CausalParentId },
        accepted: observation,
      };
    },
    open(scope) {
      return {
        subscribe(deliver, end) {
          let closed = false;
          let acquiring = true;
          let revision: number | null = null;
          let stopAcks = () => {};
          let stopSnapshot = () => {};
          const buffered: WorkWriteAck[] = [];
          const admission = { routeKey: scope.route, fingerprint: scope.fingerprint, ...(scope.reading ? { reading: scope.reading } : {}) };
          const request = { ...scope.key, kind: "work" as const, admission };
          const stop = () => {
            if (closed) return;
            closed = true;
            stopAcks();
            stopSnapshot();
          };
          const emit = (state: WorkFeedState) => {
            if (!closed) deliver(state);
          };
          const fail = (
            message: string,
            failure: WorkFeedFailure = { kind: "failed", code: "WorkFeedFailed", message },
          ) => {
            if (closed) return;
            if (failure.kind === "registration-mismatch")
              reload.set(`${scope.route}:${scope.fingerprint}`, failure);
            emit({ kind: "failed", failure });
            stop();
            end();
          };
          const recover = (to: number) => {
            if (closed || acquiring || revision === null) return;
            acquiring = true;
            emit({ kind: "gap", from: revision + 1, to });
            emit({ kind: "pending" });
            if (!closed) {
              try {
                source.dirty(request);
              } catch (error) {
                fail(error instanceof Error ? error.message : String(error));
              }
            }
          };
          let draining = false;
          const drain = () => {
            if (draining) return;
            draining = true;
            try {
              buffered.sort((a, b) => a.revision - b.revision);
              while (!closed && !acquiring && buffered.length) {
                const ack = buffered[0]!;
                if (ack.revision <= revision!) {
                  buffered.shift();
                  continue;
                }
                if (ack.revision !== revision! + 1 || ack.base !== revision) {
                  recover(ack.revision);
                  if (!acquiring && revision! >= ack.revision - 1) continue;
                  break;
                }
                buffered.shift();
                revision = ack.revision;
                emit({ kind: "ack", ack });
              }
            } finally {
              draining = false;
            }
          };
          emit({ kind: "pending" });
          const mismatch = reload.get(`${scope.route}:${scope.fingerprint}`);
          if (mismatch) {
            fail(workFeedFailureMessage(mismatch), mismatch);
            return stop;
          }
          try {
            // A synchronous replay is buffered before the snapshot subscription even exists.
            stopAcks = source.subscribe(
              { kind: "work-acks", work: scope.key, admission },
              (frame) => {
                if (closed) return;
                if (frame.kind === "stale" || ("stale" in frame && frame.stale)) {
                  acquiring = true; emit({ kind: "pending" }); return;
                }
                if (frame.kind === "failure")
                  return fail(
                    frame.failure ? workFeedFailureMessage(frame.failure) : frame.error,
                    frame.failure,
                  );
                if (frame.kind === "gap")
                  return fail("Work acknowledgement transport lost an unknown revision interval");
                if (frame.kind === "snapshot" && acquiring) {
                  const parsed = snapshotSchema.safeParse(frame.value);
                  if (!parsed.success) return fail(parsed.error.message);
                  revision = parsed.data.revision;
                  acquiring = false;
                  emit({
                    kind: "ready",
                    snapshot: Object.assign({ handle: parsed.data.handle, revision, value: parsed.data.doc }, { bodyReceipts: frame.changed ? undefined : frame.bodyReceipts }),
                    history: parsed.data.history,
                  });
                  drain();
                  return;
                }
                if (frame.kind !== "event") return;
                const parsed = workWriteAckSchema.safeParse(frame.value);
                if (!parsed.success) return fail(parsed.error.message);
                if (workKey(parsed.data.key) !== workKey(scope.key))
                  return fail("Work acknowledgement belongs to another Work");
                buffered.push(parsed.data);
                drain();
              },
            );
            if (closed) {
              stopAcks();
              return stop;
            }
            stopSnapshot = source.subscribe(request, (frame) => {
              if (closed) return;
              if (frame.kind === "stale" || ("stale" in frame && frame.stale)) {
                acquiring = true; emit({ kind: "pending" }); return;
              }
              if (frame.kind === "failure")
                return fail(
                  frame.failure ? workFeedFailureMessage(frame.failure) : frame.error,
                  frame.failure,
                );
              if (!acquiring || frame.kind !== "snapshot") return;
              const parsed = snapshotSchema.safeParse(frame.value);
              if (!parsed.success) return fail(parsed.error.message);
              revision = parsed.data.revision;
              acquiring = false;
              emit({
                kind: "ready",
                snapshot: Object.assign({ handle: parsed.data.handle, revision, value: parsed.data.doc }, { bodyReceipts: frame.changed ? undefined : frame.bodyReceipts }),
                history: parsed.data.history,
              });
              drain();
            });
            if (closed) stopSnapshot();
          } catch (error) {
            fail(error instanceof Error ? error.message : String(error));
          }
          return stop;
        },
      };
    },
  };
}
