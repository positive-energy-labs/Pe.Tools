import { z } from "zod";
import { workKey, workWriteAckSchema, type WorkWriteAck } from "@pe/agent-contracts";
import type {
  WorkJournalDoor,
  WorkFeedState,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { peReadings, type Readings } from "../readings";

const snapshotSchema = z.object({ revision: z.number().int().nonnegative(), doc: z.unknown() });

/** The acquisition half of the journal door, over the existing resource stream.
 * TODO: Bind generic Work submission when the journal door can name a Work write;
 * ActionAdmission currently names semantic commands only, not revision-checked patches.
 */
export function createWorkFeedClient(
  source: Readings = peReadings,
): Pick<WorkJournalDoor, "lifetime" | "open"> {
  return {
    lifetime: "subscription",
    open(scope) {
      return {
        subscribe(deliver, end) {
          let closed = false;
          let acquiring = true;
          let revision: number | null = null;
          let stopAcks = () => {};
          let stopSnapshot = () => {};
          const buffered: WorkWriteAck[] = [];
          const request = { ...scope.key, kind: "work" as const };
          const stop = () => {
            if (closed) return;
            closed = true;
            stopAcks();
            stopSnapshot();
          };
          const emit = (state: WorkFeedState) => {
            if (!closed) deliver(state);
          };
          const fail = (message: string) => {
            if (closed) return;
            emit({ kind: "failed", failure: { code: "WorkFeedFailed", message } });
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
          try {
            // A synchronous replay is buffered before the snapshot subscription even exists.
            stopAcks = source.subscribe({ kind: "work-acks", work: scope.key }, (frame) => {
              if (closed || ("stale" in frame && frame.stale)) return;
              if (frame.kind === "failure") return fail(frame.error);
              if (frame.kind === "gap")
                return fail("Work acknowledgement transport lost an unknown revision interval");
              if (frame.kind !== "event") return;
              const parsed = workWriteAckSchema.safeParse(frame.value);
              if (!parsed.success) return fail(parsed.error.message);
              if (workKey(parsed.data.key) !== workKey(scope.key))
                return fail("Work acknowledgement belongs to another Work");
              buffered.push(parsed.data);
              drain();
            });
            if (closed) {
              stopAcks();
              return stop;
            }
            stopSnapshot = source.subscribe(request, (frame) => {
              if (closed || ("stale" in frame && frame.stale)) return;
              if (frame.kind === "failure") return fail(frame.error);
              if (!acquiring || frame.kind !== "snapshot") return;
              const parsed = snapshotSchema.safeParse(frame.value);
              if (!parsed.success) return fail(parsed.error.message);
              revision = parsed.data.revision;
              acquiring = false;
              emit({
                kind: "ready",
                snapshot: { key: scope.key, revision, value: parsed.data.doc },
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
