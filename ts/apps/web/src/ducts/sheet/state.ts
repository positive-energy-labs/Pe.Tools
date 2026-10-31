import type { OpenSheet } from "../sources";
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
