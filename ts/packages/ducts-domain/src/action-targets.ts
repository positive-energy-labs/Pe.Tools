import { fanCandidates } from "./fan-assignment.ts";
import type { DuctSnapshot } from "./types.ts";

/** The pair as a candidate over the snapshot the route read; throws why it is not offered. */
export const fanOf = (snapshot: DuctSnapshot, pair: { unitId: number; systemId: number }) => {
  const found = fanCandidates(snapshot, pair.unitId).find((c) => c.systemId === pair.systemId);
  if (!found)
    throw Error(
      `System ${pair.systemId} has base equipment, or ${pair.unitId} roots none of its groups`,
    );
  return found;
};
