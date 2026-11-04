import type { Immutable } from "../../../../../packages/agent-contracts/src/route-kernel-data";
import type { OpenSheet } from "../neutral.ts";
import { detailOf, takenClosures, tierCounts } from "./tiers";

export function sheetState(sheet: OpenSheet | null) {
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
  return {
    blockers,
    tiers: tierCounts(blockers),
    taken: takenClosures(sheet?.inputs?.notes ?? []),
    inputs: sheet?.inputs?.inputs ?? null,
    firm: sheet?.inputs?.firm ?? null,
  };
}

export const EMPTY_SHEET_STATE: Immutable<ReturnType<typeof sheetState>> = sheetState(null);
