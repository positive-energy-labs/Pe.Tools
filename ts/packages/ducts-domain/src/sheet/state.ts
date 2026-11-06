import type { Immutable } from "@pe/agent-contracts";
import type { z } from "zod";
import type { openFanSheetSchema } from "@pe/agent-contracts";
type OpenSheet = Immutable<z.output<typeof openFanSheetSchema>>;
import { detailOf, takenClosures, tierCounts } from "./tiers.ts";

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
