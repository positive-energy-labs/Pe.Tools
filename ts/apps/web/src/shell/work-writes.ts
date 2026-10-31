import {
  workKey,
  type CellsDecl,
  type RouteStateWriteResult,
  type WorkKey,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import type { MountScope } from "./mount-owner";
import { acquireWorkJournal, type JournalDetail } from "./journal";

interface WriteHistory {
  entry: JournalDetail;
  accepted(ack: WorkWriteAck): void;
}
type DescribeWrite = (request: WorkWrite, label: string) => WriteHistory | undefined;

function writeLabel<W>(request: WorkWrite, cells: readonly CellsDecl<W>[]) {
  const names = [
    ...new Set(
      request.patches.map(({ path }) => {
        const family = cells.find((cell) => path[0] === (cell.segment ?? cell.key));
        const key = family?.segment === null ? path[0] : path[1];
        return family && typeof key === "string"
          ? (family.label?.(key) ?? key)
          : path.join(".") || "Work";
      }),
    ),
  ];
  const deleting = request.patches.every((patch) => !Object.hasOwn(patch, "value"));
  const verb = deleting
    ? request.patches.every(({ path }) => path.at(-1) === "suggestion")
      ? "Reject"
      : "Revert"
    : "Edit";
  return `${verb} ${names.join(", ") || "Work"}`;
}

type WritePort = (key: WorkKey, request: WorkWrite) => Promise<RouteStateWriteResult>;
const refused = (error: string): RouteStateWriteResult => ({
  ok: false,
  kind: "refused",
  error,
  hint: "Review the retained edit, then retry or discard it",
});
const writers = new Map<string, ReturnType<typeof createWorkWriter>>();

/** The same identity owns admission, refused intents and the journal in every mount. */
export function acquireWorkWriter(key: WorkKey) {
  const id = workKey(key);
  let writer = writers.get(id);
  if (!writer) {
    writer = createWorkWriter(key, () => writers.delete(id));
    writers.set(id, writer);
  }
  return writer.acquire();
}

function createWorkWriter(key: WorkKey, remove: () => void) {
  const identity = workKey(key);
  const held = acquireWorkJournal(key);
  const pending = new Map<string, { request: WorkWrite; label: string; history?: WriteHistory }>();
  const historians = new Set<DescribeWrite>();
  const listeners = new Set<() => void>();
  let readers = 0;
  let running = 0;
  let retired = false;
  let conflict: number | null = null;
  let observedRevision = 0;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const retire = () => {
    if (retired || readers || running || pending.size) return;
    retired = true;
    held.release();
    remove();
  };
  const settle = () => {
    conflict = null;
    held.journal.hold(false);
  };
  const accept = (ack: WorkWriteAck) => {
    if (workKey(ack.key) !== identity) return;
    const intent = ack.press ? pending.get(ack.press) : undefined;
    held.journal.accept(ack, intent && { label: intent.label, ...intent.history?.entry });
    if (ack.press) {
      if (intent) {
        held.journal.describe(ack.press, { label: intent.label, ...intent.history?.entry });
        intent.history?.accepted(ack);
      }
      pending.delete(ack.press);
    }
    if (conflict !== null && ack.revision > conflict) settle();
    notify();
  };
  const observe = (scope: MountScope<unknown>) => {
    const work = scope.work;
    if (work && workKey(work.handle.key) === identity) {
      observedRevision = Math.max(observedRevision, work.handle.revision);
      held.journal.observe({ revision: work.handle.revision, doc: work.doc });
    }
    if (
      conflict !== null &&
      work &&
      workKey(work.handle.key) === identity &&
      work.handle.revision > conflict
    ) {
      settle();
      notify();
    }
  };
  const write = async <W>(
    scope: MountScope<W>,
    request: WorkWrite,
    port: WritePort,
    cells: readonly CellsDecl<W>[] = [],
    history?: WriteHistory,
  ): Promise<RouteStateWriteResult> => {
    request = structuredClone(request);
    if (request.kind === "apply" && request.press)
      pending.set(request.press, { request, label: writeLabel(request, cells), history });
    running++;
    observe(scope);
    let result: RouteStateWriteResult;
    try {
      const current = scope.workKey ?? scope.work?.handle.key;
      const failure = !current
        ? "This route has no Work"
        : workKey(current) !== identity
          ? "That edit belongs to another Work"
          : scope.closed
            ? "This Work only reads"
            : (scope.failure ??
              (!scope.work ? "Work has not been read yet" : null) ??
              (conflict !== null || scope.conflict ? "Work changed; review and retry" : null));
      const domain =
        !failure && request.kind === "apply"
          ? cells
              .filter((family) =>
                request.patches.some(
                  ({ path }) => !path.length || path[0] === (family.segment ?? family.key),
                ),
              )
              .map((family) => family.admit?.(scope.work!.doc, request.patches))
              .find((reason) => reason != null)
          : null;
      if (!failure && !domain && request.press) {
        const intent = pending.get(request.press);
        if (intent && !intent.history)
          for (const describe of historians) {
            intent.history = describe(request, intent.label);
            if (intent.history) break;
          }
      }
      result =
        failure || domain ? refused(failure ?? domain!.message) : await port(current!, request);
      if (result.ok) {
        const ack = result.write;
        if (
          workKey(ack.key) !== identity ||
          ack.base !== request.expectedRevision ||
          ack.kind !== request.kind ||
          ack.press !== request.press
        )
          result = refused("The acknowledgement does not match this Work edit");
        else {
          if (Object.hasOwn(result, "doc"))
            held.journal.observe({ revision: ack.revision, doc: result.doc });
          accept(ack);
        }
      } else if (
        result.code === "stale_revision" &&
        scope.work?.handle.revision === request.expectedRevision &&
        observedRevision <= request.expectedRevision &&
        (held.journal.read().revision ?? 0) <= request.expectedRevision
      ) {
        conflict = request.expectedRevision;
        held.journal.hold(true);
      }
    } catch (cause) {
      result = refused(cause instanceof Error ? cause.message : String(cause));
    } finally {
      running--;
      notify();
      retire();
    }
    return result;
  };
  const writer = {
    journal: held.journal,
    /** The mounted route supplies derived history for the same writer chat and composer use. */
    describeWrites(describe: DescribeWrite) {
      historians.add(describe);
      return () => {
        historians.delete(describe);
      };
    },
    accept,
    observe,
    write,
    conflict: () => conflict !== null,
    pending: () => [...pending.values()].map(({ request }) => structuredClone(request)),
    discard(press: string) {
      pending.delete(press);
      notify();
      retire();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    acquire() {
      readers++;
      let released = false;
      return {
        writer,
        release(this: void) {
          if (released) return;
          released = true;
          readers--;
          retire();
        },
      };
    },
  };
}

export type WorkWriter = ReturnType<typeof acquireWorkWriter>["writer"];
