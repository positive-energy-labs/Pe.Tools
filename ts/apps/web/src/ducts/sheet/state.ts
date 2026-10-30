import type { DuctsRouteDocument } from "@pe/agent-contracts";
import type { OpenSheet } from "../sources";
import { detailOf, takenClosures, tierCounts } from "./tiers";
import type { SheetDefaults } from "./types";
export const SHIM_TERMINAL_DROP_SOURCE = "SHIM placeholder";
export function sheetState(sheet: OpenSheet | null, doc: DuctsRouteDocument | null) {
  const blockers = sheet
    ? [
        ...new Map(
          (
            sheet.inputs?.blockers ??
            [...sheet.overview.blockers, ...sheet.overview.assumedBlockers].map(detailOf)
          ).map((blocker) => [blocker.id, blocker]),
        ).values(),
      ]
    : [];
  const inputs = sheet?.inputs?.inputs ?? [];
  const edited = doc?.sheetDefaults.edit?.value ?? {};
  const drop =
    inputs.find((input) => input.name === "terminal drop in-wg") ??
    inputs.find((input) => input.name === "SHIM terminal drop in-wg");
  const box = inputs.find((input) => input.name === "auto-join maximum gap in");
  const split = inputs.find((input) => input.name === "split policy");
  const defaults: SheetDefaults = {
    terminalDropInWg:
      edited.terminalDropInWg ?? (typeof drop?.value === "number" ? drop.value : null),
    terminalDropSource:
      edited.terminalDropInWg !== undefined
        ? "route settings terminal drop"
        : (drop?.source ?? SHIM_TERMINAL_DROP_SOURCE),
    autoJoinMaxGapIn:
      edited.autoJoinMaxGapIn ?? (typeof box?.value === "number" ? box.value : null),
    splitPolicy: edited.splitPolicy ?? (split?.value === "proportional" ? "proportional" : "even"),
    basis: sheet?.overview.basis ?? null,
  };
  return {
    blockers,
    tiers: tierCounts(blockers),
    taken: takenClosures(inputs),
    defaults,
    projectInputs: sheet?.inputs?.edits ?? {},
  };
}
