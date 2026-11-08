import {
  workKey,
  workWriteAckSchema,
  type RouteGraph,
  type WorkKey,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import type { ScopeToken } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { legacyLiveVerbs } from "./legacy-environment-bridge";

import type { WorkJournal } from "./journal";
import { acquireWorkWriter, writeLabel, type WorkWriter } from "./work-writes";

import { type MountAdapters, type MountBinding } from "./mount-contracts";
import type { MountPage } from "./mount-page-owner";
import type { MountReadings } from "./mount-readings-owner";
import type { MountTarget } from "./mount-target-owner";
import { type VerbContext, type PendingWorkHistory } from "./verbs";
/** Owns Work writers, conflicts, rejected edits and revision-bound journal descriptions. */
export function createMountWork<P, W>(
  graph: RouteGraph<P, W>,
  adapters: MountAdapters<P, W>,
  target: MountTarget<W>,
  page: MountPage<P, W>,
  readings: MountReadings<P, W>,
  ports: {
    snapshot(): ReturnType<VerbContext["snapshot"]>;
    dispatch(press: string): { verb: string; input: MountBinding | null } | undefined;
  },
) {
  // One Work per mount at a time: the stale write's key and the revision it was refused against.
  let conflict: { work: string; revision: number } | null = null;
  let rejected: { key: WorkKey; request: WorkWrite; verb: string; input: MountBinding } | null =
    null;
  let scope = target.raw;
  let journalRefusal: string | null = null;
  const journals = new Map<string, WorkJournal>();
  const writers = new Map<string, WorkWriter>();
  const releaseJournals: (() => void)[] = [];
  const deltas = new Map<string, () => void>();
  // Human and Pea reach the same flag: the host's stale refusal sets it, any accepted delta or a
  // newer read of the Work clears it.
  const present = () => {
    scope =
      conflict && target.raw.work && workKey(target.raw.work.handle.key) === conflict.work
        ? { ...target.raw, conflict: true }
        : target.raw;
  };
  const flag = (next: typeof conflict) => {
    const prior = conflict;
    if (prior?.work === next?.work && prior?.revision === next?.revision) return;
    conflict = next;
    present();
  };
  const journalFor = (key: WorkKey) => {
    const id = workKey(key);
    let journal = journals.get(id);
    if (!journal) {
      const acquired = acquireWorkWriter(key);
      const writer = acquired.writer;
      writers.set(id, writer);
      journal = writer.journal;
      // Before the accepted-delta replay below: a reloaded tab names the host's steps by this graph.
      journal.name((patches) => writeLabel(patches, graph));
      releaseJournals.push(
        acquired.release,
        writer.describeWrites((request, label) => {
          const history = adapters.workHistory;
          if (
            !history ||
            !target.connected ||
            target.disposed ||
            !target.available() ||
            !scope.work ||
            workKey(scope.work.handle.key) !== id ||
            scope.work.handle.revision !== request.expectedRevision
          )
            return;
          const before = structuredClone({
            snapshot: ports.snapshot(),
            page: page.view.read().page as Readonly<Record<string, unknown>>,
            subject: null,
            value: scope.work.doc,
            readings: Object.fromEntries(
              Object.keys(graph.readings).map((id) => [id, readings.get(id)]),
            ),
          });
          if (
            history.readings?.some(
              (id) =>
                !before.readings[id]?.current ||
                before.readings[id]?.basis?.workRevision !== request.expectedRevision,
            )
          )
            return;
          const input = { request, label };
          const pending: PendingWorkHistory = {
            entry: history.describe(before, input),
            readings: history.readings ?? [],
            complete: (after) => history.describe(before, input, after),
          };
          const started = target.acceptance.capture();
          const epoch = page.view.read().epoch;
          return {
            entry: pending.entry,
            accepted: (ack) => {
              if (!target.disposed) recordHistory(key, ack, pending, started, epoch);
            },
          };
        }),
        writer.subscribe(() => {
          if (target.raw.work && workKey(target.raw.work.handle.key) === id)
            flag(
              writer.conflict() ? { work: id, revision: target.raw.work.handle.revision } : null,
            );
          target.notify();
        }),
      );
      journals.set(id, journal);
      if (writer.conflict() && target.raw.work && workKey(target.raw.work.handle.key) === id)
        flag({ work: id, revision: target.raw.work.handle.revision });
    }
    if (target.connected && !target.disposed && !deltas.has(id))
      deltas.set(
        id,
        adapters.subscribeAcceptedDeltas(key, (ack) => {
          writers.get(id)!.accept(workWriteAckSchema.parse(ack));
        }),
      );
    return journal;
  };
  if (scope.work) journalFor(scope.work.handle.key);
  const historyCompletions = new Map<
    string,
    {
      key: WorkKey;
      revision: number;
      token: ScopeToken;
      epoch: number;
      history: PendingWorkHistory;
    }
  >();
  const completeHistory = () => {
    for (const [press, pending] of historyCompletions) {
      if (
        !target.acceptance.current(pending.token) ||
        pending.epoch !== page.view.read().epoch ||
        (scope.work && scope.work.handle.revision > pending.revision)
      ) {
        historyCompletions.delete(press);
        continue;
      }
      if (!scope.work || scope.work.handle.revision !== pending.revision) continue;
      const after = Object.fromEntries(
        pending.history.readings.map((id) => [id, readings.get(id)]),
      );
      if (
        !Object.values(after).every(
          (state) =>
            state.current &&
            state.basis?.workRevision === pending.revision &&
            state.basis.attempt.workKey &&
            workKey(state.basis.attempt.workKey) === workKey(pending.key),
        )
      )
        continue;
      journalFor(pending.key).describe(press, pending.history.complete(after));
      historyCompletions.delete(press);
    }
  };
  const recordHistory = (
    key: WorkKey,
    ack: WorkWriteAck,
    history: PendingWorkHistory,
    started: ScopeToken,
    epoch: number,
  ) => {
    if (!ack.press) return;
    journalFor(key).describe(ack.press, history.entry);
    journalRefusal = null;
    if (history.readings.length) {
      historyCompletions.set(ack.press, {
        key,
        revision: ack.revision,
        token: started,
        epoch,
        history,
      });
      completeHistory();
    }
    target.notify();
  };
  const write = async (
    key: WorkKey,
    request: WorkWrite,
    history?: PendingWorkHistory,
    sequential = false,
  ) => {
    const started = target.acceptance.capture();
    const epoch = page.view.read().epoch;
    const invocation = request.press ? ports.dispatch(request.press) : undefined;
    journalFor(key);
    const result = await writers.get(workKey(key))!.write(
      scope,
      request,
      (key, request) => adapters.write(key, request),
      graph,
      history && {
        entry: history.entry,
        accepted: (ack) => {
          if (!target.disposed) recordHistory(key, ack, history, started, epoch);
        },
      },
      sequential,
    );
    if (
      !target.disposed &&
      !result.ok &&
      "code" in result &&
      result.code === "stale_revision" &&
      invocation?.input
    )
      rejected = structuredClone({ key, request, verb: invocation.verb, input: invocation.input });
    target.notify();
    return result;
  };
  return {
    legacyCommands: (adapters.legacyEnvironment ?? legacyLiveVerbs).commands,
    get scope() {
      return scope;
    },
    get conflict() {
      return conflict;
    },
    get rejected() {
      return rejected;
    },
    set rejected(value) {
      rejected = value;
    },
    journals,
    writers,
    journalFor,
    write,
    completeHistory,
    journalRefusal: () => journalRefusal,
    present,
    update() {
      const seen = target.raw.work;
      if (
        conflict &&
        (!seen ||
          workKey(seen.handle.key) !== conflict.work ||
          seen.handle.revision !== conflict.revision)
      )
        flag(null);
      else present();
      if (scope.work) {
        journalFor(scope.work.handle.key);
        writers.get(workKey(scope.work.handle.key))!.observe(scope);
      }
    },
    connect() {
      for (const journal of journals.values()) journalFor(journal.key);
    },
    disconnect() {
      for (const release of deltas.values()) release();
      deltas.clear();
    },
    async restore(this: void, direction: "undo" | "redo", press?: string) {
      if (!scope.work || target.disposed || !target.available()) return null;
      const key = structuredClone(scope.work.handle.key);
      const result = await journalFor(key)[direction]((request) => write(key, request), press);
      journalRefusal = result.ok ? null : result.message;
      target.notify();
      return result;
    },
    dispose() {
      historyCompletions.clear();
      for (const release of releaseJournals.reverse()) release();
    },
  };
}
export type MountWork<P, W> = ReturnType<typeof createMountWork<P, W>>;
