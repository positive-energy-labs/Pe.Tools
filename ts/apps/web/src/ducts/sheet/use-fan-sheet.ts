/**
 * The fan sheet adapted to the /ducts shell: `useSheet` (roster, open, compute all, inputs edits,
 * rulings) plus what the variants read on top: blockers in detail, their tier counts, the engine's
 * taken closures, the project inputs the host last merged (R2: one `sheetInputs.project` cell for
 * every fan), and the versioned `defaults` object (document Work `sheetDefaults`, the one cell the
 * host pins into the basis hash) with its write. Closer verbs are described in `closer.ts` and
 * dispatched here, once.
 */
import { useCallback, useMemo } from "react";
import { transitionPatches, type DocumentRef, type DuctsSheetInputs } from "@pe/agent-contracts";
import type { ProtoProps } from "../proto/props";
import { rosterOrder } from "./api";
import { describeCloser, type Closer } from "./closer";
import { detailOf, takenClosures, tierCounts, type SheetBlocker } from "./tiers";
import type { SheetDefaults } from "./types";
import { useSheet } from "./use-sheet";

/** SHIM(ducts-terminal-drop): the engine's placeholder until the firm's per-family table lands. */
export const SHIM_TERMINAL_DROP_SOURCE = "SHIM placeholder";

export function useFanSheet(
  target: DocumentRef,
  work: ProtoProps["work"],
  nameOf: (id: number) => string | null,
) {
  const state = useSheet(target);
  const { sheet } = state;
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
  const taken = useMemo(() => takenClosures(sheet?.inputs?.inputs ?? []), [sheet]);
  const projectInputs: DuctsSheetInputs = sheet?.inputs?.edits ?? {};
  const cell = work.doc?.sheetDefaults ?? {};
  const edited = cell.edit?.value ?? {};
  const defaults = useMemo<SheetDefaults>(() => {
    const inputs = sheet?.inputs?.inputs ?? [];
    const drop =
      inputs.find((i) => i.name === "terminal drop in-wg") ??
      inputs.find((i) => i.name === "SHIM terminal drop in-wg");
    const box = inputs.find((i) => i.name === "auto-join maximum gap in");
    const split = inputs.find((i) => i.name === "split policy");
    return {
      terminalDropInWg:
        edited.terminalDropInWg ?? (typeof drop?.value === "number" ? drop.value : null),
      terminalDropSource:
        edited.terminalDropInWg !== undefined
          ? "route settings terminal drop"
          : (drop?.source ?? SHIM_TERMINAL_DROP_SOURCE),
      // The gap the read was measured under (C#'s default unless route settings name one).
      autoJoinMaxGapIn:
        edited.autoJoinMaxGapIn ?? (typeof box?.value === "number" ? box.value : null),
      splitPolicy:
        edited.splitPolicy ?? (split?.value === "proportional" ? "proportional" : "even"),
      basis: sheet?.overview.basis ?? null,
    };
  }, [sheet, edited.terminalDropInWg, edited.autoJoinMaxGapIn, edited.splitPolicy]);
  // A default changes every sheet; once the write lands, re-read the open fan so its number moves.
  const setDefaults = useCallback(
    (next: Partial<Omit<SheetDefaults, "basis" | "terminalDropSource">>) =>
      void Promise.resolve(
        work.write(
          transitionPatches([], "sheetDefaults", cell, {
            kind: "set",
            rung: { value: { ...edited, ...next } },
          }) as never,
        ),
      ).then(() => {
        if (sheet?.overview.fan) state.changeInputs({});
      }),
    [work, cell, edited, sheet, state],
  );
  /**
   * One blocker's closer, described with the sheet-wide wait and the firm drop: verb, refusal,
   * inline input and action. `typed` is the row's input value, null when empty.
   */
  const closerOf = useCallback(
    (blocker: SheetBlocker, typed: number | null): Closer =>
      describeCloser(blocker, typed, {
        defaults,
        dropSource:
          defaults.terminalDropSource === SHIM_TERMINAL_DROP_SOURCE
            ? "firm shim"
            : defaults.terminalDropSource,
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
      }),
    [defaults, nameOf, state.busy, sheet],
  );
  /** Run one live closer's action; a refused closer is a no-op, the row already says why. */
  const close = useCallback(
    (closer: Closer) => {
      if (closer.refusal || !closer.action) return;
      const { action } = closer;
      switch (action.kind) {
        // SHIM(ducts-sheet-write): a heal is ruled on the basis; no typed Revit heal door yet.
        case "rule":
          return void state.ruleProposal({ pair: action.pair, verdict: "accept" });
        // R-CAP: the host replaces the array wholesale, so the write carries every end ruling.
        case "cap":
          return void state.changeInputs({
            endRulings: [
              ...(projectInputs.endRulings ?? []).filter(
                (r) =>
                  r.end.elementId !== action.end.elementId ||
                  r.end.connector !== action.end.connector,
              ),
              { end: action.end, verdict: "capped" },
            ],
          });
        case "drop":
          return void state.changeInputs({ drops: { [action.elementId]: action.value } });
        case "cfm":
          return void state.changeInputs({ endCfm: { [action.elementId]: action.value } });
        case "unitCfm":
          return void state.changeInputs({ unitCfm: { [action.unitId]: action.value } });
      }
    },
    [state, projectInputs.endRulings],
  );
  const roster = useMemo(() => rosterOrder(state.rows), [state.rows]);
  return {
    ...state,
    roster,
    blockers,
    tiers,
    taken,
    defaults,
    projectInputs,
    setDefaults,
    closerOf,
    close,
  };
}
export type FanSheetState = ReturnType<typeof useFanSheet>;
