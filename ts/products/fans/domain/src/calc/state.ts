import type { Immutable } from "@pe/agent-contracts";
import type { z } from "zod";
import type { openFanCalcSchema } from "@pe/agent-contracts";
type OpenCalc = Immutable<z.output<typeof openFanCalcSchema>>;
import { detailOf, takenClosures, tierCounts } from "./tiers.ts";

export function calcState(sheet: OpenCalc | null) {
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

export const EMPTY_CALC_STATE: Immutable<ReturnType<typeof calcState>> = calcState(null);
