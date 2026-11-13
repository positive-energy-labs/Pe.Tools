import {
  workFeedFailureMessage,
  workFeedFailureSchema,
  type WorkFeedFailure,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { z } from "zod";
import {
  actionStatusSchema,
  actionReceiptSchema,
  workHandleSchema,
  workKey,
  workWriteAckSchema,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import type {
  WorkJournalDoor,
  WorkFeedState,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { peReadings, type Readings } from "../host/resource-stream";
import { writeRouteWork } from "../route/host";
import { submitAction, waitForAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type {
  AcceptedResult,
  WorkWriteOutcome,
  JournalCommandId,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import type { CausalParentId } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { commandTable } from "@pe/agent-contracts/command-axes";
import { hostFetch } from "../host/runtime";
import { opResponseSchema } from "../host/catalog-client";
import type { ActionAdmission } from "@pe/agent-contracts/semantic-actions";
import type { CommandHandle } from "@pe/agent-contracts/handle";
import { handle } from "@pe/agent-contracts/handle";
import { httpRoutes } from "@pe/agent-contracts/pe-api";
import { HOST_RPC_BRIDGE_SESSION_HEADER, HOST_RPC_DOCUMENT_HEADER } from "@pe/host-contracts/operation-types";

type DirectAnswer = { state: "answered"; result: unknown };
/** One send door: only the minted handle selects a transport. */
export async function sendCommand(
  command: CommandHandle,
  admission: ActionAdmission,
  ports = { submit: submitAction, fetch: hostFetch,
    decode: async (key: string, value: unknown) => (await opResponseSchema(key)).parse(value) },
): Promise<Awaited<ReturnType<typeof submitAction>> | DirectAnswer> {
  if (command.key !== admission.key) throw Error("Handle and admission command differ");
  if (command.via === "command") return ports.submit(admission);
  const route = command.via.route;
  let path: string;
  let method = "POST";
  let body: unknown = admission.input;
  let nativeKey: string | undefined;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (route === "actions.read") {
    path = "/actions?id=" + encodeURIComponent(String(admission.input.id));
    method = "GET";
  } else if (route.startsWith("action.")) {
    path = "/actions/" + route.slice("action.".length);
  } else if (route === "page.bind") {
    path = "/pe/pages/" + encodeURIComponent(String(admission.input.slug)) + "/binding";
    method = "PUT";
    body = admission.input.binding;
  } else if (route === "operation.call") {
    const op = z.object({ key: z.string(), intent: z.string() }).parse(admission.input.op);
    if (op.intent.toLowerCase() !== "read") throw Error("ops.read requires a native Read");
    nativeKey = op.key;
    path = "/call";
    body = { key: op.key, request: admission.input.request };
    if (admission.target.kind === "document") {
      headers[HOST_RPC_BRIDGE_SESSION_HEADER] = admission.target.ref.session;
      headers[HOST_RPC_DOCUMENT_HEADER] = admission.target.ref.openId;
    } else if (admission.target.kind === "session") headers[HOST_RPC_BRIDGE_SESSION_HEADER] = admission.target.session;
  } else if (route === "family.readings" || route === "schedules.readings") {
    path = httpRoutes[route].path;
    const { work, ...input } = admission.input;
    const scope = route === "family.readings" && command.key !== "family.saved"
      ? workHandleSchema.parse(work).key : undefined;
    body = { key: command.key, input,
      target: admission.target.kind === "document" ? admission.target.ref : undefined,
      ...(scope ? { scope } : {}) };
  } else throw Error(`Unsupported command transport: ${route}`);
  const started = performance.now();
  const response = await ports.fetch(path, { method, headers,
    signal: AbortSignal.timeout(30_000),
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw Error(typeof result?.error === "string" ? result.error : result?.error?.message ?? `Command refused (${response.status})`);
  if (route.startsWith("action") && route !== "actions.read")
    return { state: "answered", result: actionReceiptSchema.parse(result) };
  if (route === "actions.read") {
    const row = actionReceiptSchema.array().parse(result).find((row) => row.id === admission.input.id);
    if (!row) throw Error("Original action not found");
    return { state: "answered", result: row };
  }
  return { state: "answered", result: nativeKey !== undefined
    ? { kind: "value", value: await ports.decode(nativeKey, result), elapsedMs: Math.round(performance.now() - started),
        op: nativeKey, request: admission.input.request,
        document: admission.target.kind === "document" ? admission.target.ref : null } : result };
}

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
const isCommandKey = (key: string): key is keyof typeof commandTable => Object.hasOwn(commandTable, key);
export const browserWorkPorts = { write: writeRouteWork, submit: (admission: ActionAdmission) => {
  if (!isCommandKey(admission.key)) throw Error(`Unknown command: ${admission.key}`);
  return sendCommand(handle(admission.key), admission);
} };
/** Kernel door (ADR 0026) for a surface that must follow one receipt to its end, e.g. a confirmed outward send. */
export const followAction = (id: string) => waitForAction(id);

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
            if (frame.kind === "gap") {
              cursor = null;
              deliver({ kind: "pending" });
              source.dirty(request, "subject");
              return;
            }
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
                source.dirty(request, "subject");
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
            row.state === "answered"
              ? { kind: "accepted-native", outcome: "committed", result: row.result }
              : row.state === "detached"
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
          const admission = {
            routeKey: scope.route,
            fingerprint: scope.fingerprint,
            ...(scope.reading ? { reading: scope.reading } : {}),
          };
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
                  const wasReady = !acquiring;
                  acquiring = true;
                  emit({ kind: "pending" });
                  // The ack stream can invalidate after the snapshot already arrived.
                  // Pending must own a new snapshot request, not wait for an unrelated edit.
                  if (wasReady && !closed) {
                    try {
                      source.dirty(request);
                    } catch (error) {
                      fail(error instanceof Error ? error.message : String(error));
                    }
                  }
                  return;
                }
                if (frame.kind === "failure")
                  return fail(
                    frame.failure ? workFeedFailureMessage(frame.failure) : frame.error,
                    frame.failure,
                  );
                if (frame.kind === "gap")
                  return fail("Work acknowledgement transport lost an unknown revision interval");
                if (frame.kind === "snapshot" && acquiring) {
                  if (frame.value === null) {
                    buffered.length = 0;
                    revision = null;
                    emit({ kind: "absent" });
                    return;
                  }
                  const parsed = snapshotSchema.safeParse(frame.value);
                  if (!parsed.success) return fail(parsed.error.message);
                  revision = parsed.data.revision;
                  acquiring = false;
                  emit({
                    kind: "ready",
                    snapshot: { handle: parsed.data.handle, revision, value: parsed.data.doc },
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
                acquiring = true;
                emit({ kind: "pending" });
                return;
              }
              if (frame.kind === "failure")
                return fail(
                  frame.failure ? workFeedFailureMessage(frame.failure) : frame.error,
                  frame.failure,
                );
              if (!acquiring || frame.kind !== "snapshot") return;
              if (frame.value === null) {
                buffered.length = 0;
                revision = null;
                emit({ kind: "absent" });
                return;
              }
              const parsed = snapshotSchema.safeParse(frame.value);
              if (!parsed.success) return fail(parsed.error.message);
              revision = parsed.data.revision;
              acquiring = false;
              emit({
                kind: "ready",
                snapshot: { handle: parsed.data.handle, revision, value: parsed.data.doc },
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
