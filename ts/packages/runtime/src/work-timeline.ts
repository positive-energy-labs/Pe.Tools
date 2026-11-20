import {
  workKey,
  sameReceiptWork,
  type ActionStatus,
  type StepRef,
  type TimelineRow,
  type WorkAuthor,
  type WorkKey,
  type WorkTimeline,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { createWorkJournal, type WorkJournal } from "./work-journal.ts";

/** One Work as the host holds it: its key, its current value and its retained acks, oldest first. */
export interface TimelineWork {
  readonly key: WorkKey;
  readonly snapshot: { revision: number; doc: unknown } | null;
  readonly acks: readonly WorkWriteAck[];
}
/** The step one source would take for a caller, when it was last moved, and why it is refused. */
export interface TimelineCandidate {
  readonly ref: StepRef;
  readonly at: number;
  readonly refusal: string | null;
}
/** What one source contributes: its rows oldest first, and the caller's next step each way. */
export interface TimelinePart {
  readonly rows: readonly TimelineRow[];
  readonly undo: TimelineCandidate | null;
  readonly redo: TimelineCandidate | null;
}

export const sameStep = (a: StepRef, b: StepRef): boolean =>
  "work" in a
    ? "work" in b && workKey(a.work) === workKey(b.work) && a.revision === b.revision
    : !("work" in b) && a.home === b.home && a.sha256 === b.sha256;

const pathLabel = (ack: WorkWriteAck) =>
  ack.patches[0]?.path.length ? `Edit ${ack.patches[0].path.join(".")}` : "Edit Work";

/**
 * The host's journal for one Work: its acks replayed, then every receipt recorded, so the journal's
 * own barrier rule runs (a step a successful Revit write consumed cannot be stepped back).
 */
export function timelineJournal(
  work: TimelineWork,
  receipts: readonly ActionStatus[],
): WorkJournal {
  const journal = createWorkJournal(work.key);
  // An ack stored without a stamp sorts first. The journal would otherwise read the clock, and the
  // same history would then project differently on each read.
  for (const ack of work.acks) journal.accept({ ...ack, at: ack.at ?? 0, replay: true });
  if (work.snapshot) journal.observe(work.snapshot);
  for (const receipt of receipts)
    journal.record({
      kind: "receipt",
      at: receipt.startedAt,
      receiptId: receipt.id,
      paths: receipt.consumes.flatMap((item) =>
        item.kind === "work" && sameReceiptWork(item.probe.handle.key, work.key)
          ? item.probe.paths
          : [],
      ),
      outcome: receipt.outcome,
      basis: { receipt },
    });
  return journal;
}

/** Pure projection of the Works' journals for one caller. Undo is per author on every Work. */
export function projectWorks(
  works: readonly TimelineWork[],
  receipts: readonly ActionStatus[],
  by: WorkAuthor,
  journals: readonly WorkJournal[] = works.map((work) => timelineJournal(work, receipts)),
): TimelinePart {
  const rows: TimelineRow[] = [];
  const candidates = { undo: [] as TimelineCandidate[], redo: [] as TimelineCandidate[] };
  const named = (id: string | undefined) => receipts.find((receipt) => receipt.id === id);
  works.forEach((work, index) => {
    const state = journals[index]!.read();
    const steps = new Map([
      ...state.undo.map((step) => [step.id, { step, undone: false as boolean }] as const),
      ...state.redo.map((step) => [step.id, { step, undone: true as boolean }] as const),
    ]);
    for (const ack of work.acks) {
      if (ack.kind === "publish") continue;
      const found =
        ack.kind === "apply" && ack.undoable
          ? steps.get(
              ack.step ?? `${ack.by === "pea" ? "pea:" : ""}${ack.press ?? `r${ack.revision}`}`,
            )
          : undefined;
      const step = found?.step;
      const receipt = step?.barrier?.receiptId;
      rows.push({
        kind: ack.kind === "restore" ? "restore" : "edit",
        work: work.key,
        revision: ack.revision,
        by: ack.by,
        label: ack.label ?? step?.label ?? pathLabel(ack),
        state: found?.undone
          ? "undone"
          : step?.superseded
            ? "superseded"
            : step?.barrier
              ? "blocked"
              : "applied",
        ...(step?.notWritten ? { notWritten: step.notWritten } : {}),
        ...(step?.superseded
          ? { blockedBy: { reason: step.superseded.message } }
          : receipt
            ? { blockedBy: { receipt, label: named(receipt)?.key ?? receipt } }
            : {}),
        at: ack.at ?? 0,
      });
    }
    for (const direction of ["undo", "redo"] as const) {
      const step = state[direction].findLast((entry) => entry.by === by);
      const transition = step?.transitions[direction === "undo" ? step.cursor - 1 : step.cursor];
      if (!step || !transition) continue;
      const receipt = step.barrier?.receiptId;
      candidates[direction].push({
        ref: { work: work.key, revision: transition.revision, label: step.label },
        // The step's last move, so a redo takes the most recently undone step across Works.
        at: state.moves.findLast((move) => move.press === step.press)?.at ?? step.at,
        refusal: step.superseded
          ? `${step.superseded.message}; ${direction} would overwrite it`
          : receipt
            ? `Cannot ${direction} "${step.label}": ${named(receipt)?.key ?? "a write"} (${receipt}) already consumed it`
            : null,
      });
    }
  });
  for (const receipt of receipts) {
    const consumed = receipt.consumes.find(
      (item) =>
        item.kind === "work" &&
        works.some((work) => sameReceiptWork(item.probe.handle.key, work.key)),
    );
    if (consumed?.kind !== "work") continue;
    const work = works.find((work) => sameReceiptWork(consumed.probe.handle.key, work.key));
    if (!work) throw Error(`Missing timeline Work for receipt ${receipt.id}`);
    rows.push({
      kind: "receipt",
      id: receipt.id,
      work: work.key,
      label: receipt.key,
      by: receipt.caller.kind === "pea" ? "pea" : "human",
      state:
        receipt.state === "running" && receipt.cancellationRequested ? "stopping" : receipt.state,
      ...(receipt.progress ? { progress: receipt.progress } : {}),
      at: Date.parse(receipt.startedAt) || 0,
    });
  }
  const latest = (list: TimelineCandidate[]) =>
    list.reduce<TimelineCandidate | null>(
      (best, next) => (!best || next.at > best.at ? next : best),
      null,
    );
  return { rows, undo: latest(candidates.undo), redo: latest(candidates.redo) };
}

const rowTime = (row: TimelineRow) =>
  typeof row.at === "number" ? row.at : Date.parse(row.at) || 0;

/**
 * One Timeline from every source: rows in host order, and the one next step across all of them.
 * A refused step is not offered: `undo` is null and `refusal.undo` says why.
 */
export function mergeTimeline(parts: readonly TimelinePart[]): {
  timeline: WorkTimeline;
  undo: { source: number; candidate: TimelineCandidate } | null;
  redo: { source: number; candidate: TimelineCandidate } | null;
} {
  const pick = (direction: "undo" | "redo") =>
    parts.reduce<{ source: number; candidate: TimelineCandidate } | null>((best, part, source) => {
      const candidate = part[direction];
      return candidate && (!best || candidate.at > best.candidate.at)
        ? { source, candidate }
        : best;
    }, null);
  const undo = pick("undo"),
    redo = pick("redo");
  const offered = (pick: typeof undo) =>
    pick && !pick.candidate.refusal ? pick.candidate.ref : null;
  return {
    timeline: {
      // Array.prototype.sort is stable: rows that share a time keep their source order.
      rows: parts.flatMap((part) => part.rows).sort((a, b) => rowTime(a) - rowTime(b)),
      undo: offered(undo),
      redo: offered(redo),
      refusal: { undo: undo?.candidate.refusal ?? null, redo: redo?.candidate.refusal ?? null },
    },
    undo,
    redo,
  };
}
