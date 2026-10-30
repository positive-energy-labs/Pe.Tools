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
type Step = {
  press: string;
  transitions: Transition[];
  /** Number of transitions currently applied; a failed multi-write replay resumes here. */
  cursor: number;
  barrier?: TimelineBarrier;
};

export type JournalResult =
  | { ok: true; press: string; revision: number }
  | {
      ok: false;
      code: "empty" | "barrier" | "busy" | "write-refused" | "interrupted";
      message: string;
      barrier?: TimelineBarrier;
    };
export type JournalWriter = (write: WorkWrite) => Promise<RouteStateWriteResult>;

const shared = new Map<
  string,
  { journal: ReturnType<typeof createWorkJournal>; readers: number }
>();
/** Mounts of the same persisted Work share history, independent of transport provenance. */
export function acquireWorkJournal(key: WorkKey) {
  const id = workKey(key);
  let entry = shared.get(id);
  if (!entry) {
    entry = { journal: createWorkJournal(key), readers: 0 };
    shared.set(id, entry);
  }
  entry.readers++;
  let released = false;
  return {
    journal: entry.journal,
    release: () => {
      if (released) return;
      released = true;
      if (--entry.readers === 0) shared.delete(id);
    },
  };
}

const overlaps = (a: RouteStatePatch["path"], b: RouteStatePatch["path"]) =>
  a
    .slice(0, Math.min(a.length, b.length))
    .every((part, index) => String(part) === String(b[index]));
const footprint = (write: Pick<WorkWriteAck, "patches" | "inverse">) =>
  [...write.patches, ...write.inverse].map(({ path }) => path);

/** In-memory history for exactly one Work. Call accept for local acks AND accepted host deltas. */
export function createWorkJournal(key: WorkKey) {
  const identity = workKey(key);
  let revision: number | null = null;
  let undo: Step[] = [];
  let redo: Step[] = [];
  let pending: { direction: "undo" | "redo"; step: Step } | null = null;
  let sending: WorkWrite | null = null;
  let busy = false;
  let generation = 0;
  // A stale write marks the Work as changed under the person: nothing replays across it until it clears.
  let held = false;

  const clear = () => {
    undo = [];
    redo = [];
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

  const accept = (acknowledged: WorkWriteAck): void => {
    if (workKey(acknowledged.key) !== identity) return;
    const ack = structuredClone(acknowledged);
    // Local callbacks and the host stream can deliver the same acknowledgement twice.
    if (revision !== null && ack.revision <= revision) return;
    if (revision !== null && ack.base !== revision) clear();
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
    if (ack.by !== "human" || ack.kind !== "apply" || !ack.press || !ack.undoable) {
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
    } else undo.push({ press: ack.press, transitions: [transition], cursor: 1 });
  };

  const replay = async (
    direction: "undo" | "redo",
    write: JournalWriter,
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
    const blocked = (): JournalResult | null =>
      step.barrier
        ? {
            ok: false,
            code: "barrier",
            message: `Cannot ${direction} '${step.press}': barrier '${step.barrier.receiptId ?? step.barrier.verb ?? step.barrier.at}' changed its paths`,
            barrier: structuredClone(step.barrier),
          }
        : null;
    const refusal = blocked();
    if (refusal) return refusal;
    busy = true;
    pending = { direction, step };
    const started = generation;
    try {
      while (direction === "undo" ? step.cursor > 0 : step.cursor < step.transitions.length) {
        const barrier = blocked();
        if (barrier) return barrier;
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
    /** Subscribe this to the route timeline before dispatching commands; retain barriers after its log is trimmed. */
    record,
    /** The mount's conflict flag: while held, undo and redo refuse with a barrier. */
    hold(on: boolean) {
      held = on;
    },
    undo: (write: JournalWriter) => replay("undo", write),
    redo: (write: JournalWriter) => replay("redo", write),
    read: () => structuredClone({ revision, undo, redo, busy }),
  };
}

export type WorkJournal = ReturnType<typeof createWorkJournal>;
