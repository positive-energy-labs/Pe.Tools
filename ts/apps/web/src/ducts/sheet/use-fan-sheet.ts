/**
 * The fan sheet adapted to the /ducts shell: `useSheet` (roster, open, compute all, edits,
 * rulings) plus what the view reads on top: blockers in detail, their tier counts, the engine's
 * taken closures, and the open sheet's resolved inputs and firm layer (ducts LEDGER 2026-10-29:
 * the host resolves every value; the page shows sources and writes edits on Work's own keys).
 * Closer verbs are described in `closer.ts` and dispatched here, once.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  transitionPatches,
  type CellLike,
  type DocumentRef,
  type DuctsSheetEdits,
  type DuctsSheetOverview,
} from "@pe/agent-contracts";
import { editCells } from "@pe/ducts-domain/sheet/index";
import { cellsAt, effectWords, restorePatches, type Step } from "./input-history";
import type { ProtoProps } from "../proto/props";
import { rosterOrder } from "./api";
import { describeCloser, type Closer } from "./closer";
import { detailOf, takenClosures, tierCounts, type SheetBlocker } from "./tiers";
import { useSheet } from "./use-sheet";

export function useFanSheet(
  target: DocumentRef,
  work: ProtoProps["work"],
  nameOf: (id: number) => string | null,
) {
  const state = useSheet(target);
  const { sheet } = state;
  // Undo and redo of this page's input edits (`input-history.ts`): cells snapshotted before each
  // edit, written back through the route's revision-bound Work writer on undo.
  const doc = useRef(work.doc);
  doc.current = work.doc;
  const [past, setPast] = useState<Step[]>([]);
  const [future, setFuture] = useState<Step[]>([]);
  const inflight = useRef(new Set<string>());
  const [last, setLast] = useState<{ label: string; words: string; refusal?: string } | null>(null);
  type Meta = { label: string; rowKey?: string | null; clear?: boolean; was?: string };
  const track = useCallback(
    async (
      edits: DuctsSheetEdits,
      meta: Meta,
      run: () => Promise<DuctsSheetOverview | null> = () => state.changeInputs(edits),
      redo = false,
    ) => {
      // One edit in flight at a time per content: a cell's Enter and its blur must not post twice
      // (the second POST raced the first and was refused "document moved", 2026-10-30).
      const id = JSON.stringify(edits);
      if (inflight.current.has(id)) return;
      inflight.current.add(id);
      try {
        await trackOnce(edits, meta, run, redo);
      } finally {
        inflight.current.delete(id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trackOnce is redefined each render with these
    [state, sheet],
  );
  async function trackOnce(
    edits: DuctsSheetEdits,
    meta: Meta,
    run: () => Promise<DuctsSheetOverview | null>,
    redo: boolean,
  ) {
    {
      const cells = editCells(edits);
      const before = cellsAt(doc.current, cells);
      const totals = sheet?.overview.totals ?? null;
      const result = await run();
      if (!result) return;
      const step: Step = {
        label: meta.label,
        rowKey: meta.rowKey ?? null,
        clear: meta.clear ?? false,
        edits,
        cells,
        before,
        was: meta.was ?? "",
        effect: { before: totals, after: result.totals },
      };
      setPast((p) => [...p.slice(-49), step]);
      setFuture((f) => (redo ? f.slice(0, -1) : []));
      setLast({ label: `${redo ? "redid " : ""}${meta.label}`, words: effectWords(totals, result.totals) });
    }
  }
  const undo = useCallback(async () => {
    const step = past.at(-1);
    if (!step || state.busy) return;
    const refusal = await work.write(restorePatches(step.cells, step.before) as never);
    if (refusal) {
      const text = (refusal as { error?: string }).error ?? String(refusal);
      return setLast({ label: `undo ${step.label}`, words: "", refusal: text });
    }
    const totals = sheet?.overview.totals ?? null;
    const result = await state.recompute();
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, step]);
    setLast({ label: `undid ${step.label}`, words: result ? effectWords(totals, result.totals) : "" });
  }, [past, state, sheet, work]);
  /**
   * A Work write that is no sheet edit (take or unsuggest of a Pea suggestion on a choice cell):
   * written through the route's writer, then the open fan repriced; recorded like any edit.
   */
  const write = useCallback(
    async (patches: ReturnType<typeof transitionPatches>, cells: string[][], meta: Meta, redo = false) => {
      const before = cellsAt(doc.current, cells);
      const totals = sheet?.overview.totals ?? null;
      const refusal = await work.write(patches as never);
      if (refusal) {
        const message = (refusal as { error?: string }).error ?? String(refusal);
        setLast({ label: meta.label, words: "", refusal: message });
        return { code: "refused", message };
      }
      const result = await state.recompute();
      const after = result?.totals ?? null;
      setPast((p) => [
        ...p.slice(-49),
        { label: meta.label, rowKey: meta.rowKey ?? null, clear: false, edits: {}, patches, cells, before, was: meta.was ?? "", effect: { before: totals, after } },
      ]);
      setFuture((f) => (redo ? f.slice(0, -1) : []));
      setLast({ label: meta.label, words: effectWords(totals, after) });
      return null;
    },
    [state, sheet, work],
  );
  const act = useCallback(
    (path: readonly string[], cell: CellLike, kind: "take" | "unsuggest", label: string) =>
      write(
        transitionPatches(path.slice(0, -1), path.at(-1)!, cell, { kind }),
        [[...path]],
        { label: `${kind === "take" ? "take" : "unsuggest"} Pea's ${label}` },
      ),
    [write],
  );
  const redo = useCallback(async () => {
    const step = future.at(-1);
    if (!step || state.busy) return;
    if (step.patches) await write(step.patches, step.cells, step, true);
    else await track(step.edits, step, undefined, true);
  }, [future, state.busy, track, write]);
  const history = {
    track,
    act,
    write,
    undo,
    redo,
    last,
    undoLabel: past.at(-1)?.label ?? null,
    redoLabel: future.at(-1)?.label ?? null,
    /** The step a "restore" on its own row takes back: the last edit, when it was a clear. */
    cleared: past.at(-1)?.clear ? past.at(-1)! : null,
  };
  const blockers = useMemo<SheetBlocker[]>(
    () =>
      sheet
        ? [
            ...new Map(
              (
                sheet.inputs?.blockers ??
                [...sheet.overview.blockers, ...sheet.overview.assumedBlockers].map(detailOf)
              ).map((b) => [b.id, b]),
            ).values(),
          ]
        : [],
    [sheet],
  );
  const tiers = useMemo(() => tierCounts(blockers), [blockers]);
  const taken = useMemo(() => takenClosures(sheet?.inputs?.notes ?? []), [sheet]);
  const inputs = sheet?.inputs?.inputs ?? null;
  const firm = sheet?.inputs?.firm ?? null;
  /**
   * One blocker's closer, described with the sheet-wide wait and the firm drop: verb, refusal,
   * inline input and action. `typed` is the row's input value, null when empty.
   */
  const closerOf = useCallback(
    (blocker: SheetBlocker, typed: number | null): Closer =>
      describeCloser(blocker, typed, {
        terminalDrop: inputs?.criteria.terminalDropInWg ?? null,
        nameOf,
        wait: state.busy
          ? "Wait for the current read"
          : sheet?.inputs
            ? null
            : "Reading inputs detail",
        fan: sheet?.overview.fan
          ? {
              unitId: sheet.overview.fan.unitId,
              name: sheet.overview.fan.mark || nameOf(sheet.overview.fan.unitId) || "unit",
            }
          : null,
        receiving: ({ elementId, connector }) => {
          const fan = sheet?.inputs?.ends.find(
            (end) =>
              end.kind !== "terminal" &&
              end.elementId === elementId &&
              (end.connector ?? null) === (connector ?? null),
          )?.fan;
          if (!fan || fan.unitId === sheet?.overview.fan?.unitId) return null;
          const mark = state.rows.find((row) => row.unitId === fan.unitId)?.mark;
          return { unitId: fan.unitId, name: mark || nameOf(fan.unitId) || `unit ${fan.unitId}` };
        },
        fittingOf: (key) => sheet?.inputs?.fittings.find((f) => f.key === key) ?? null,
        tableTitles: sheet?.inputs?.tableTitles ?? {},
      }),
    [inputs, nameOf, state.busy, state.rows, sheet],
  );
  /** Run one live closer's action; a refused closer is a no-op, the row already says why. */
  const close = useCallback(
    (closer: Closer) => {
      if (closer.refusal || !closer.action) return;
      const { action } = closer;
      const edit = (edits: DuctsSheetEdits) => void track(edits, { label: closer.verb });
      switch (action.kind) {
        // SHIM(ducts-sheet-write): a heal is ruled on the basis; no typed Revit heal door yet.
        case "rule":
          return void track(
            { joins: [{ pair: action.pair, verdict: "accept" }] },
            { label: closer.verb },
            () => state.ruleProposal({ pair: action.pair, verdict: "accept" }),
          );
        case "cap":
          return edit({ ends: [{ end: action.end, verdict: "capped" }] });
        case "drop":
          return edit(
            action.terminal
              ? { terminalDrops: { [action.elementId]: { inWg: action.value } } }
              : { componentDrops: { [action.elementId]: { inWg: action.value } } },
          );
        case "cfm":
          return edit({ flows: { [action.elementId]: { cfm: action.value } } });
        case "unitCfm":
          return edit({
            equipmentFlows: { [action.unitId]: { cfm: action.value } },
          });
        case "price":
          return edit({
            assignments: { [action.family]: { rule: action.rule } },
            ...(action.table ? { tables: { [action.rule]: { table: action.table } } } : {}),
          });
        case "table":
          return edit({ tables: { [action.rule]: { table: action.table } } });
        case "pathDrop":
          return edit({ fittingDrops: { [action.key]: { inWg: action.value } } });
      }
    },
    [state, track],
  );
  const roster = useMemo(() => rosterOrder(state.rows), [state.rows]);
  return {
    ...state,
    roster,
    blockers,
    tiers,
    taken,
    inputs,
    firm,
    closerOf,
    close,
    history,
  };
}
export type FanSheetState = ReturnType<typeof useFanSheet>;
