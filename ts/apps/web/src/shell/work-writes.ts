import {
  workKey,
  type RouteGraph,
  type RouteStatePatch,
  type WorkFieldDecl,
  type RouteStateWriteResult,
  type WorkKey,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import type { MountScope } from "./work-scope";
import { acquireWorkJournal, type JournalDetail } from "./journal";

interface WriteHistory {
  entry: JournalDetail;
  accepted(ack: WorkWriteAck): void;
}
type DescribeWrite = (request: WorkWrite, label: string) => WriteHistory | undefined;

/** What History and Inputs may call a Work path: route-declared, never the raw path. */
export type WorkNames<W = unknown> = Pick<RouteGraph<unknown, W>, "cells" | "workFields">;
/** Kernel Work fields every route schema may carry; declared once here, not per route. */
const KERNEL_FIELDS: Readonly<Record<string, WorkFieldDecl>> = {
  writeIntent: { label: "write scope", internal: true },
};

/** A Work path's declared name, or null when no route or kernel declaration names it. */
export function workPathName<W>(
  names: WorkNames<W>,
  path: RouteStatePatch["path"],
): { label: string; internal: boolean } | null {
  const family = names.cells?.find((cell) => path[0] === (cell.segment ?? cell.key));
  const key = family?.segment === null ? path[0] : path[1];
  if (family && typeof key === "string")
    return { label: family.label?.(key) ?? family.noun ?? key, internal: false };
  const field = names.workFields?.[String(path[0])] ?? KERNEL_FIELDS[String(path[0])];
  return field ? { label: field.label, internal: field.internal === true } : null;
}

/** One press's History name; `internal` when every path is staging the person never edits. */
export function writeLabel<W>(
  patches: readonly RouteStatePatch[],
  names: WorkNames<W>,
): JournalDetail & { internal?: true } {
  const named = patches.map(({ path }) => workPathName(names, path));
  // ponytail: an undeclared field reads "Work"; the work-labels guard test keeps every route declared.
  const words = [...new Set(named.map((name) => name?.label ?? "Work"))];
  const deleting = patches.every((patch) => !Object.hasOwn(patch, "value"));
  const verb = deleting
    ? patches.every(({ path }) => path.at(-1) === "suggestion")
      ? "Reject"
      : "Revert"
    : "Edit";
  const internal = named.length > 0 && named.every((name) => name?.internal);
  return { label: `${verb} ${words.join(", ") || "Work"}`, ...(internal && { internal: true }) };
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
  const pending = new Map<
    string,
    { request: WorkWrite; label: JournalDetail & { internal?: true }; history?: WriteHistory }
  >();
  const historians = new Set<DescribeWrite>();
  const listeners = new Set<() => void>();
  let readers = 0;
  let running = 0;
  let retired = false;
  let conflict: number | null = null;
  let observedRevision = 0;
  let tail = Promise.resolve();
  // Only our acknowledged edits may advance a queued human intent. Foreign writes still refuse.
  const acknowledged = new Map<number, { revision: number; doc?: unknown }>();
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
    held.journal.accept(ack, intent && { ...intent.label, ...intent.history?.entry });
    if (ack.press) {
      if (intent) {
        held.journal.describe(ack.press, { ...intent.label, ...intent.history?.entry });
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
    names: WorkNames<W> = {},
    history?: WriteHistory,
    sequential = false,
  ): Promise<RouteStateWriteResult> => {
    request = structuredClone(request);
    if (names.cells || names.workFields) held.journal.name((patches) => writeLabel(patches, names));
    const cells = names.cells ?? [];
    if (request.kind === "apply" && request.press)
      pending.set(request.press, { request, label: writeLabel(request.patches, names), history });
    running++;
    const before = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await before;
    if (sequential && request.kind === "apply") {
      let next = acknowledged.get(request.expectedRevision);
      while (next) {
        request.expectedRevision = next.revision;
        if (scope.work)
          scope = {
            ...scope,
            work: {
              ...scope.work,
              handle: { ...scope.work.handle, revision: next.revision },
              doc: (next.doc ?? scope.work.doc) as W,
            },
          };
        next = acknowledged.get(request.expectedRevision);
      }
    }
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
            intent.history = describe(request, intent.label.label);
            if (intent.history) break;
          }
      }
      result =
        failure || domain ? refused(failure ?? domain!.message) : await port(current!, { ...request, ...(request.press && pending.get(request.press) ? { label: pending.get(request.press)!.history?.entry.label ?? pending.get(request.press)!.label.label } : {}) });
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
          acknowledged.set(ack.base, {
            revision: ack.revision,
            ...(Object.hasOwn(result, "doc") ? { doc: result.doc } : {}),
          });
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
      release();
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
