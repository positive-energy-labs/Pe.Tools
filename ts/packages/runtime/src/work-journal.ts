import type { z } from "zod";
import type { GraphJsonValue as JsonValue } from "../../agent-contracts/src/route-graph.ts";
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
import type { InvocationOutcome, ActionStatus } from "@pe/agent-contracts";
export interface TimelineEntry {
  kind: "invocation" | "receipt" | "checkpoint" | "feed";
  at: string | number;
  press?: string;
  verb?: string;
  subject?: unknown;
  receiptId?: string;
  paths?: readonly RouteStatePatch["path"][];
  basis?: unknown;
  outcome?: InvocationOutcome;
}
export type TimelineBarrier = TimelineEntry & {
  kind: "receipt";
  paths: readonly RouteStatePatch["path"][];
};
export const receiptBarrier = (entry: TimelineEntry): TimelineBarrier | null =>
  entry.kind === "receipt" &&
  entry.paths?.length &&
  (!entry.outcome || ["succeeded", "outcome-unknown"].includes(entry.outcome.state))
    ? (structuredClone(entry) as TimelineBarrier)
    : null;

type Transition = {
  revision: number;
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
  detailSource: "accepted" | "historical";
  id: string;
  press: string;
  /** Who authored the step: the person in this tab, or Pea through the shared Work door. */
  by: "human" | "pea";
  /** When the step was accepted (ms). */
  at: number;
  transitions: Transition[];
  /** Number of transitions currently applied; a failed multi-write replay resumes here. */
  cursor: number;
  barrier?: TimelineBarrier;
  notWritten?: { invocation: string; reason: string; rejected: boolean };
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
  let from = 0;
  let current: { revision: number; doc: unknown } | null = null;
  let undo: Step[] = [];
  let redo: Step[] = [];
  /** The latest move and who made it: an undo or redo may be Pea's (`work.history`) or this person's. */
  let last: { kind: "apply" | "undo" | "redo"; step: Step; by: "human" | "pea" } | null = null;
  let moves: JournalMove[] = [];
  let namer: Namer = () => ({ label: "Edit Work" });
  const unnamed = new Set<string>();
  const move = (kind: JournalMove["kind"], step: Step, by: "human" | "pea", at: number) => {
    last = { kind, step, by };
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
    ];
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
    unnamed.clear();
    pending = null;
    generation++;
  };
  const writes = new Map<string, ActionStatus>();
  const record = (entry: TimelineEntry): void => {
    const receipt = (entry.basis as { receipt?: ActionStatus } | undefined)?.receipt;
    if (receipt?.consumes.length) writes.set(receipt.id, structuredClone(receipt));
    const barrier = receiptBarrier(entry);
    if (!barrier) return;
    for (const step of [...undo, ...redo])
      if (
        !step.barrier &&
        step.transitions.some(
          (transition) =>
            transition.paths.some((path) => barrier.paths.some((other) => overlaps(path, other))) &&
            (!receipt ||
              receipt.consumes.some(
                (item) =>
                  item.kind === "work" &&
                  workKey(item.probe.handle.key) === identity &&
                  transition.revision <= item.probe.handle.revision,
              )),
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
  const applyAcknowledgement = (acknowledged: WorkWriteAck, detail?: JournalDetail): void => {
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
      sending.restoreOf === ack.restoreOf;
    if (ownRestore) return;
    // Pea's undo/redo (`work.history`) or another mount's restore of the top step walks this same
    // journal: the step moves across exactly as if this mount had replayed it.
    if (ack.kind === "restore" && !pending) {
      const undone = undo.at(-1);
      const back = undone?.transitions[undone.cursor - 1];
      if (undone && back && !undone.superseded && back.revision === ack.restoreOf) {
        back.forward = ack.inverse;
        back.revision = ack.revision;
        if (--undone.cursor === 0) {
          redo.push(undo.pop()!);
          move("undo", undone, ack.by, ack.at ?? Date.now());
        }
        return;
      }
      const redone = redo.at(-1);
      const ahead = redone?.transitions[redone.cursor];
      if (redone && ahead && !redone.superseded && ahead.revision === ack.restoreOf) {
        ahead.inverse = ack.inverse;
        ahead.revision = ack.revision;
        if (++redone.cursor === redone.transitions.length) {
          undo.push(redo.pop()!);
          move("redo", redone, ack.by, ack.at ?? Date.now());
        }
        return;
      }
    }
    const pea = ack.by === "pea" && ack.kind === "apply" && ack.undoable;
    if (ack.kind === "apply" && ack.undoable) {
      ack.press = pea
        ? `pea:${ack.press ?? `r${ack.revision}`}`
        : (ack.press ?? `r${ack.revision}`);
      if (!detail && !ack.label) unnamed.add(ack.step ?? ack.press);
      detail ??= ack.label
        ? { label: ack.label, ...(ack.meta !== undefined && { meta: ack.meta }) }
        : { ...namer(ack.patches), ...(ack.meta !== undefined && { meta: ack.meta }) };
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
        if (path && !ack.receiptId) supersede(step, ack.revision, path);
      }
      record({
        kind: "receipt",
        at: Date.now(),
        receiptId: ack.receiptId ?? `work:${identity}:r${ack.revision}`,
        paths: footprint(ack),
        basis: { revision: ack.revision, by: ack.by, kind: ack.kind, receiptId: ack.receiptId },
      });
      return;
    }
    if (!ack.patches.length && !ack.inverse.length) return;
    // A new authored edit during partial replay starts from its actual accepted preimage.
    if (pending) clear();
    // An admitted new edit ends a redo branch, regardless of its timestamp or path.
    redo = [];
    const transition: Transition = {
      revision: ack.revision,
      forward: ack.patches,
      inverse: ack.inverse,
      paths: footprint(ack),
    };
    const prior = undo.find((step) => step.id === (ack.step ?? ack.press));
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
        detailSource: "accepted",
        label: detail.label.trim() || namer(ack.patches).label,
        id: ack.step ?? ack.press,
        press: ack.press,
        by: pea ? "pea" : "human",
        at: ack.at ?? Date.now(),
        transitions: [transition],
        cursor: 1,
      });
    move("apply", undo.at(-1)!, pea ? "pea" : "human", ack.at ?? Date.now());
  };

  // Receipts outlive the visible revision and undo branch, including start-fresh.
  const receipts = new Map<number, WorkWriteAck>();
  const reconcile = (
    ack: WorkWriteAck,
    detail?: JournalDetail,
  ): "recorded" | "duplicate" | "contradiction" | "wrong-work" => {
    if (workKey(ack.key) !== identity) return "wrong-work";
    const canonical = (write: WorkWriteAck) => {
      const { replay: _replay, key: _key, ...rest } = write;
      return canonicalRouteInput({ ...rest, key: identity });
    };
    const prior = receipts.get(ack.revision);
    if (prior) return canonical(prior) === canonical(ack) ? "duplicate" : "contradiction";
    receipts.set(ack.revision, structuredClone(ack));
    // Late history is retained verbatim. Never replay it into a newer undo branch or Work.
    applyAcknowledgement(ack, detail);
    return "recorded";
  };
  const accept = (ack: WorkWriteAck, detail?: JournalDetail): void => {
    reconcile(ack, detail);
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
    let acceptedAt = Date.now();
    let acceptedBy: "human" | "pea" = "human";
    try {
      while (direction === "undo" ? step.cursor > 0 : step.cursor < step.transitions.length) {
        const barrier = blocked();
        if (barrier) return barrier;
        const precondition = verify();
        if (precondition) return precondition;
        const transition = step.transitions[direction === "undo" ? step.cursor - 1 : step.cursor]!;
        sending = {
          kind: "restore",
          restoreOf: transition.revision,
          label: `${direction === "undo" ? "undid" : "redid"} ${step.label}`,
          patches: structuredClone(direction === "undo" ? transition.inverse : transition.forward),
          expectedRevision: revision,
          press: null,
        };
        const request = structuredClone(sending);
        const result = await write(request);
        if (!result.ok) return { ok: false, code: "write-refused", message: refusalText(result) };
        if (
          workKey(result.write.key) !== identity ||
          result.write.kind !== "restore" ||
          result.write.base !== request.expectedRevision
        )
          return {
            ok: false,
            code: "write-refused",
            message: "Restore acknowledgement does not match this Work and revision",
          };
        if (started !== generation) {
          accept(result.write);
          return {
            ok: false,
            code: "interrupted",
            message: "Work history changed while restoring; re-read Work",
          };
        }
        acceptedAt = result.write.at ?? Date.now();
        acceptedBy = result.write.by === "pea" ? "pea" : "human";
        accept(result.write);
        if (Object.hasOwn(result, "doc") && (!current || result.write.revision >= current.revision))
          current = { revision: result.write.revision, doc: structuredClone(result.doc) };
        if (started !== generation)
          return {
            ok: false,
            code: "interrupted",
            message: "Work history changed while restoring; re-read Work",
          };
        transition.revision = result.write.revision;
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
      move(direction, step, acceptedBy, acceptedAt);
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
    reconcile,
    /** Rebuild only the journal view from the host's canonical acquisition. Never publish Work. */
    restoreView(
      snapshot: { revision: number; doc: unknown },
      history: Extract<
        import("../../agent-contracts/src/work-journal-door.ts").WorkFeedState,
        { kind: "ready" }
      >["history"],
    ) {
      if (revision !== null && snapshot.revision < revision) return;
      clear();
      sending = null;
      revision = null;
      from = history.from;
      for (const ack of history.acks) {
        receipts.set(ack.revision, structuredClone(ack));
        applyAcknowledgement(ack);
      }
      for (const step of [...undo, ...redo]) step.detailSource = "historical";
      revision = snapshot.revision;
      current = structuredClone(snapshot);
    },
    /** Projection only. New acks were host-decoded; old presentation is decoded tolerantly
     * under this reader's schema without mutating shared steps or canonical receipts. */
    entries: (schema?: z.ZodType) =>
      structuredClone(
        [
          ...undo.map((step) => ({ step, state: "applied" as const })),
          ...redo.map((step) => ({ step, state: "undone" as const })),
        ].map(({ step, state }) => ({
          id: step.id,
          press: step.press,
          label: step.label,
          by: step.by,
          at: step.at,
          state,
          ...(step.meta === undefined
            ? { detail: "none" as const }
            : step.detailSource === "historical" && !schema?.safeParse(step.meta).success
              ? { detail: "unavailable" as const }
              : { detail: "available" as const, meta: step.meta as JsonValue }),
        })),
      ),
    /** A read proves values only at its own revision; a newer acknowledgement invalidates it. */
    observe(snapshot: { revision: number; doc: unknown }) {
      // A delayed Reading cannot erase already accepted history. A revision is not a lifetime id.
      if (revision !== null && snapshot.revision < revision) return;
      if (!current || snapshot.revision >= current.revision) current = structuredClone(snapshot);
    },
    /** Attach cloneable presentation to an accepted press, including a late Reading result. */
    describe(press: string, detail: Partial<JournalDetail>) {
      const step = [...undo, ...redo].find((entry) => entry.press === press);
      if (!step) return;
      unnamed.delete(step.id);
      Object.assign(
        step,
        structuredClone({ ...detail, label: detail.label?.trim() || step.label }),
      );
      for (const entry of moves)
        if (entry.press === press) {
          entry.label = step.label;
          if (step.internal) entry.internal = true;
        }
    },
    /** The mounted route's Work names, for steps that arrive without local detail. */
    name(next: Namer) {
      namer = next;
      for (const step of [...undo, ...redo]) {
        const detail = namer(step.transitions.flatMap((transition) => transition.forward));
        if (unnamed.has(step.id)) {
          Object.assign(step, detail);
          for (const entry of moves) if (entry.press === step.press) Object.assign(entry, detail);
        }
      }
    },
    /** Subscribe this to the route timeline before dispatching commands; retain barriers after its log is trimmed. */
    record,
    /** The mount's conflict flag: while held, undo and redo refuse with a barrier. */
    hold(on: boolean) {
      held = on;
    },
    undo: (write: JournalWriter, press?: string) => replay("undo", write, press),
    redo: (write: JournalWriter, press?: string) => replay("redo", write, press),
    read: () => {
      for (const step of [...undo, ...redo]) {
        delete step.notWritten;
        for (const receipt of [...writes.values()].sort((a, b) =>
          a.startedAt.localeCompare(b.startedAt),
        )) {
          const consumed = receipt.consumes.find(
            (item) => item.kind === "work" && workKey(item.probe.handle.key) === identity,
          );
          if (
            consumed?.kind !== "work" ||
            step.transitions.some((t) => t.revision > consumed.probe.handle.revision)
          )
            continue;
          // TODO: Live recheck the replaced-value boundary after u2-y2's host was replaced;
          // latest-edit rejection is live-proven, older-value exclusion is deterministic-only.
          if (
            !step.transitions.some((t) =>
              t.forward.some(
                (patch) =>
                  consumed.probe.paths.some((other) => overlaps(patch.path, other)) &&
                  canonicalRouteInput(valueAt(consumed.expected, patch.path)) ===
                    canonicalRouteInput(patch.value),
              ),
            )
          )
            continue;
          if (receipt.state === "succeeded") {
            delete step.notWritten;
            // A landed edit is final even if a later command consumes the same value.
            break;
          } else if (receipt.state === "cancelled" && receipt.error.includes("rejected by"))
            step.notWritten = {
              invocation: receipt.id,
              reason: receipt.error,
              rejected: step.by === receipt.caller.kind,
            };
        }
      }
      return structuredClone({
        revision,
        from,
        undo,
        redo,
        busy,
        last,
        moves,
        receipts: [...receipts.values()].sort((a, b) => a.revision - b.revision),
      });
    },
  };
}

export type WorkJournal = ReturnType<typeof createWorkJournal>;
