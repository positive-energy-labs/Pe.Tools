import {
  canonicalRouteInput,
  refusalText,
  workKey,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type WorkKey,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { receiptBarrier, type TimelineBarrier, type TimelineEntry } from "./timeline";

type Transition = {
  forward: RouteStatePatch[];
  inverse: RouteStatePatch[];
  paths: RouteStatePatch["path"][];
};
/** Route-owned presentation only; never part of the host's patch or inverse authority. */
export interface JournalDetail {
  label: string;
  meta?: unknown;
  /** Every path is kernel or route staging (`writeIntent`): History names it, Inputs omits it. */
  internal?: true;
}
/** One accepted move on the journal, newest last: History lists undo and redo as entries too. */
export interface JournalMove {
  kind: "apply" | "undo" | "redo";
  press: string;
  label: string;
  internal?: true;
  by: "human" | "pea";
  at: number;
  revision: number;
}
type Namer = (patches: readonly RouteStatePatch[]) => JournalDetail;
type Step = JournalDetail & {
  press: string;
  /** Who authored the step: the person in this tab, or Pea through the shared Work door. */
  by: "human" | "pea";
  /** When the step was accepted (ms). */
  at: number;
  transitions: Transition[];
  /** Number of transitions currently applied; a failed multi-write replay resumes here. */
  cursor: number;
  barrier?: TimelineBarrier;
  superseded?: { revision: number; path: RouteStatePatch["path"]; message: string };
};

export type JournalResult =
  | { ok: true; press: string; revision: number }
  | {
      ok: false;
      code: "empty" | "barrier" | "busy" | "write-refused" | "interrupted" | "entry-changed";
      message: string;
      barrier?: TimelineBarrier;
    };
export type JournalWriter = (write: WorkWrite) => Promise<RouteStateWriteResult>;

const shared = new Map<string, ReturnType<typeof createWorkJournal>>();
/**
 * Mounts of the same persisted Work share history, independent of transport provenance.
 * ponytail: a journal lives for the tab's lifetime, so a route switch (/fans -> /ducts -> /fans)
 * keeps the Work's history; one small journal per Work visited. A Work changed while no mount
 * listened supersedes its steps on the next ack (base mismatch). Host-durable history is Owed.
 */
/** Test lane: a case starts with no history (Work keys repeat across cases). */
export const forgetWorkJournals = () => shared.clear();
export function acquireWorkJournal(key: WorkKey) {
  const id = workKey(key);
  let journal = shared.get(id);
  if (!journal) shared.set(id, (journal = createWorkJournal(key)));
  return { journal, release: () => {} };
}

const overlaps = (a: RouteStatePatch["path"], b: RouteStatePatch["path"]) =>
  a
    .slice(0, Math.min(a.length, b.length))
    .every((part, index) => String(part) === String(b[index]));
const footprint = (write: Pick<WorkWriteAck, "patches" | "inverse">) =>
  [...write.patches, ...write.inverse].map(({ path }) => path);

const valueAt = (doc: unknown, path: RouteStatePatch["path"]): unknown =>
  path.reduce<unknown>(
    (value, part) =>
      value !== null && typeof value === "object" && Object.hasOwn(value, part)
        ? (value as Record<string, unknown>)[part]
        : undefined,
    doc,
  );

/** Project host-issued patches only, to verify an entire replay before its first write. */
function project(doc: unknown, patches: RouteStatePatch[]): unknown {
  for (const patch of patches) {
    if (!patch.path.length) {
      doc = structuredClone(patch.value);
      continue;
    }
    let node = doc as Record<string, unknown>;
    for (const part of patch.path.slice(0, -1))
      node = (node[part] ??= {}) as Record<string, unknown>;
    const part = patch.path.at(-1)!;
    if (Object.hasOwn(patch, "value")) node[part] = structuredClone(patch.value);
    else delete node[part];
  }
  return doc;
}

/** In-memory history for exactly one Work. Call accept for local acks AND accepted host deltas. */
export function createWorkJournal(key: WorkKey) {
  const identity = workKey(key);
  let revision: number | null = null;
  let current: { revision: number; doc: unknown } | null = null;
  let undo: Step[] = [];
  let redo: Step[] = [];
  /** The latest move and who made it: an undo or redo may be Pea's (`work.history`) or this person's. */
  let last: { kind: "apply" | "undo" | "redo"; step: Step; by: "human" | "pea" } | null = null;
  let moves: JournalMove[] = [];
  let namer: Namer = () => ({ label: "Edit Work" });
  const move = (
    kind: JournalMove["kind"],
    step: Step,
    by: "human" | "pea",
    at: number,
  ) => {
    last = { kind, step, by };
    // ponytail: the tab keeps its last 100 moves, the host's own retained window.
    moves = [
      ...moves,
      {
        kind,
        press: step.press,
        label: step.label,
        ...(step.internal && { internal: true as const }),
        by,
        at,
        revision: revision ?? 0,
      },
    ].slice(-100);
  };
  let pending: { direction: "undo" | "redo"; step: Step } | null = null;
  let sending: WorkWrite | null = null;
  let busy = false;
  let generation = 0;
  // A stale write marks the Work as changed under the person: nothing replays across it until it clears.
  let held = false;

  const clear = () => {
    undo = [];
    redo = [];
    last = null;
    moves = [];
    pending = null;
    generation++;
  };
  const record = (entry: TimelineEntry): void => {
    const barrier = receiptBarrier(entry);
    if (!barrier) return;
    for (const step of [...undo, ...redo])
      if (
        !step.barrier &&
        step.transitions.some((transition) =>
          transition.paths.some((path) => barrier.paths.some((other) => overlaps(path, other))),
        )
      )
        step.barrier = barrier;
  };

  const supersede = (step: Step, at: number, path: RouteStatePatch["path"]) => {
    step.superseded ??= {
      revision: at,
      path: structuredClone(path),
      message: `${step.label} was changed elsewhere at r${at}`,
    };
  };
  const accept = (acknowledged: WorkWriteAck, detail?: JournalDetail): void => {
    if (workKey(acknowledged.key) !== identity) return;
    const ack = structuredClone(acknowledged);
    // Local callbacks and the host stream can deliver the same acknowledgement twice.
    if (revision !== null && ack.revision <= revision) return;
    if (revision !== null && ack.base !== revision)
      for (const step of [...undo, ...redo]) supersede(step, ack.revision, []);
    revision = ack.revision;
    if (ack.kind === "start-fresh") {
      clear();
      return;
    }
    const ownRestore =
      ack.kind === "restore" &&
      sending?.expectedRevision === ack.base &&
      canonicalRouteInput(sending.patches) === canonicalRouteInput(ack.patches);
    if (ownRestore) return;
    // Pea's undo/redo (`work.history`) or another mount's restore of the top step walks this same
    // journal: the step moves across exactly as if this mount had replayed it.
    if (ack.kind === "restore" && !busy && !pending) {
      const sent = canonicalRouteInput(ack.patches);
      const undone = undo.at(-1);
      const back = undone?.transitions[undone.cursor - 1];
      if (undone && back && !undone.superseded && canonicalRouteInput(back.inverse) === sent) {
        back.forward = ack.inverse;
        if (--undone.cursor === 0) redo.push(undo.pop()!);
        move("undo", undone, ack.by === "pea" ? "pea" : "human", ack.at ?? Date.now());
        return;
      }
      const redone = redo.at(-1);
      const ahead = redone?.transitions[redone.cursor];
      if (redone && ahead && !redone.superseded && canonicalRouteInput(ahead.forward) === sent) {
        ahead.inverse = ack.inverse;
        if (++redone.cursor === redone.transitions.length) undo.push(redo.pop()!);
        move("redo", redone, ack.by === "pea" ? "pea" : "human", ack.at ?? Date.now());
        return;
      }
    }
    // Pea's Work edits are undo steps (ADR 0027 rule 12, reversing ADR 0026): they arrive on the
    // accepted-delta stream without route detail and may carry no press. A person's edit the host
    // replays from its retained window is history this tab inherits (a reload): a step, named by
    // the route's declared Work names. Another tab's live edit, restore, publish and non-undoable
    // writes stay foreign: they supersede, never join this tab's undo.
    const pea = ack.by === "pea" && ack.kind === "apply" && ack.undoable;
    if (pea) {
      // Namespaced: a Pea press can never join (or forge) a person's step.
      ack.press = `pea:${ack.press ?? `r${ack.revision}`}`;
    }
    if (ack.kind === "apply" && ack.undoable && (pea || (ack.by === "human" && ack.replay))) {
      ack.press ??= `r${ack.revision}`;
      detail ??= namer(ack.patches);
    }
    if (
      !detail ||
      (!pea && ack.by !== "human") ||
      ack.kind !== "apply" ||
      !ack.press ||
      !ack.undoable
    ) {
      for (const step of [...undo, ...redo]) {
        const path = step.transitions
          .flatMap(({ paths }) => paths)
          .find((path) => footprint(ack).some((other) => overlaps(path, other)));
        if (path) supersede(step, ack.revision, path);
      }
      record({
        kind: "receipt",
        at: Date.now(),
        receiptId: `work:${identity}:r${ack.revision}`,
        paths: footprint(ack),
        basis: { revision: ack.revision, by: ack.by, kind: ack.kind },
      });
      return;
    }
    if (!ack.patches.length && !ack.inverse.length) return;
    // A new authored edit during partial replay starts from its actual accepted preimage.
    if (pending) clear();
    // An admitted new edit ends a redo branch, regardless of its timestamp or path.
    redo = [];
    const transition: Transition = {
      forward: ack.patches,
      inverse: ack.inverse,
      paths: footprint(ack),
    };
    const prior = undo.find((step) => step.press === ack.press);
    if (prior) {
      const index = undo.indexOf(prior);
      const intervening = undo.slice(index + 1);
      const conflict = intervening.find((step) =>
        step.transitions.some((later) =>
          prior.transitions.some((earlier) =>
            earlier.paths.some((path) => later.paths.some((other) => overlaps(path, other))),
          ),
        ),
      );
      // Interleaved presses cannot replay through each other's overlapping inverses.
      if (conflict && !prior.barrier)
        prior.barrier = {
          kind: "receipt",
          at: Date.now(),
          receiptId: `press:${conflict.press}`,
          paths: conflict.transitions.flatMap(({ paths }) => paths),
        };
      prior.transitions.push(transition);
      prior.cursor++;
      undo.splice(index, 1);
      undo.push(prior);
    } else
      undo.push({
        ...structuredClone(detail),
        label: detail.label.trim() || namer(ack.patches).label,
        press: ack.press,
        by: pea ? "pea" : "human",
        at: ack.at ?? Date.now(),
        transitions: [transition],
        cursor: 1,
      });
    move("apply", undo.at(-1)!, pea ? "pea" : "human", ack.at ?? Date.now());
  };

  const replay = async (
    direction: "undo" | "redo",
    write: JournalWriter,
    press?: string,
  ): Promise<JournalResult> => {
    if (busy)
      return { ok: false, code: "busy", message: "The journal is already restoring a step" };
    if (pending && pending.direction !== direction)
      return {
        ok: false,
        code: "busy",
        message: `Finish the partial ${pending.direction} before ${direction}`,
      };
    if (held) return { ok: false, code: "barrier", message: "Work changed; review and retry" };
    const source = direction === "undo" ? undo : redo;
    const step = pending?.step ?? source.at(-1);
    if (!step || revision === null)
      return { ok: false, code: "empty", message: `Nothing to ${direction}` };
    if (press !== undefined && step.press !== press)
      return {
        ok: false,
        code: "entry-changed",
        message: "The selected history entry is no longer last",
      };
    const blocked = (): JournalResult | null =>
      step.superseded
        ? {
            ok: false,
            code: "barrier",
            message: `${step.superseded.message}; ${direction} would overwrite it`,
            ...(step.barrier && { barrier: structuredClone(step.barrier) }),
          }
        : step.barrier
          ? {
              ok: false,
              code: "barrier",
              message: `Cannot ${direction} '${step.press}': barrier '${step.barrier.receiptId ?? step.barrier.verb ?? step.barrier.at}' changed its paths`,
              barrier: structuredClone(step.barrier),
            }
          : null;
    const refusal = blocked();
    if (refusal) return refusal;
    const verify = (): JournalResult | null => {
      if (!current || current.revision !== revision)
        return {
          ok: false,
          code: "barrier",
          message: `Cannot ${direction} ${step.label}: current Work values are unverified; re-read Work`,
        };
      let doc = structuredClone(current.doc);
      const transitions =
        direction === "undo"
          ? step.transitions.slice(0, step.cursor).reverse()
          : step.transitions.slice(step.cursor);
      for (const transition of transitions) {
        const expected = direction === "undo" ? transition.forward : transition.inverse;
        const patches = direction === "undo" ? transition.inverse : transition.forward;
        for (const { path } of patches) {
          const before = expected.find(
            (patch) => canonicalRouteInput(patch.path) === canonicalRouteInput(path),
          );
          if (
            !before ||
            canonicalRouteInput({ value: valueAt(doc, path) }) !==
              canonicalRouteInput({ value: before.value })
          ) {
            supersede(step, revision!, path);
            return blocked();
          }
        }
        try {
          doc = project(doc, patches);
        } catch {
          return {
            ok: false,
            code: "barrier",
            message: `Cannot ${direction} ${step.label}: current Work paths are unverified; re-read Work`,
          };
        }
      }
      return null;
    };
    busy = true;
    pending = { direction, step };
    const started = generation;
    try {
      while (direction === "undo" ? step.cursor > 0 : step.cursor < step.transitions.length) {
        const barrier = blocked();
        if (barrier) return barrier;
        const precondition = verify();
        if (precondition) return precondition;
        const transition = step.transitions[direction === "undo" ? step.cursor - 1 : step.cursor]!;
        sending = {
          kind: "restore",
          patches: structuredClone(direction === "undo" ? transition.inverse : transition.forward),
          expectedRevision: revision,
          press: null,
        };
        const result = await write(structuredClone(sending));
        if (!result.ok) return { ok: false, code: "write-refused", message: refusalText(result) };
        if (
          workKey(result.write.key) !== identity ||
          result.write.kind !== "restore" ||
          result.write.base !== sending.expectedRevision
        )
          return {
            ok: false,
            code: "write-refused",
            message: "Restore acknowledgement does not match this Work and revision",
          };
        accept(result.write);
        if (Object.hasOwn(result, "doc") && (!current || result.write.revision >= current.revision))
          current = { revision: result.write.revision, doc: structuredClone(result.doc) };
        if (started !== generation)
          return {
            ok: false,
            code: "interrupted",
            message: "Work history changed while restoring; re-read Work",
          };
        // The inverse of an accepted undo is the only host-issued redo, and vice versa.
        if (direction === "undo") {
          transition.forward = structuredClone(result.write.inverse);
          step.cursor--;
        } else {
          transition.inverse = structuredClone(result.write.inverse);
          step.cursor++;
        }
      }
      const index = source.indexOf(step);
      source.splice(index, 1);
      (direction === "undo" ? redo : undo).push(step);
      pending = null;
      move(direction, step, "human", Date.now());
      return { ok: true, press: step.press, revision };
    } catch (cause) {
      return {
        ok: false,
        code: "write-refused",
        message: cause instanceof Error ? cause.message : String(cause),
      };
    } finally {
      sending = null;
      busy = false;
      if (pending?.step === step && (step.cursor === 0 || step.cursor === step.transitions.length))
        pending = null;
    }
  };

  return {
    key: structuredClone(key),
    accept,
    /** A read proves values only at its own revision; a newer acknowledgement invalidates it. */
    observe(snapshot: { revision: number; doc: unknown }) {
      // The journal outlives its mounts (tab lifetime); a Work read back BELOW the journal's
      // revision is a new lifetime of that Work (recreated, fixture remount), so its history is
      // not this Work's and the head must not claim it.
      if (revision !== null && snapshot.revision < revision) {
        clear();
        revision = snapshot.revision;
        current = null;
      }
      if (!current || snapshot.revision >= current.revision) current = structuredClone(snapshot);
    },
    /** Attach cloneable presentation to an accepted press, including a late Reading result. */
    describe(press: string, detail: Partial<JournalDetail>) {
      const step = [...undo, ...redo].find((entry) => entry.press === press);
      if (!step) return;
      Object.assign(step, structuredClone({ ...detail, label: detail.label?.trim() || step.label }));
      for (const entry of moves)
        if (entry.press === press) {
          entry.label = step.label;
          if (step.internal) entry.internal = true;
        }
    },
    /** The mounted route's Work names, for steps that arrive without local detail. */
    name(next: Namer) {
      namer = next;
    },
    /** Subscribe this to the route timeline before dispatching commands; retain barriers after its log is trimmed. */
    record,
    /** The mount's conflict flag: while held, undo and redo refuse with a barrier. */
    hold(on: boolean) {
      held = on;
    },
    undo: (write: JournalWriter, press?: string) => replay("undo", write, press),
    redo: (write: JournalWriter, press?: string) => replay("redo", write, press),
    read: () => structuredClone({ revision, undo, redo, busy, last, moves }),
  };
}

export type WorkJournal = ReturnType<typeof createWorkJournal>;
