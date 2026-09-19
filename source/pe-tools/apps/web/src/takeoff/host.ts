/** `/takeoffs`' own host reads: the one place below the route that reaches the host (§7). */
import { candidateRegionSchema, type CandidateRegion, type DocumentRef } from "@pe/agent-contracts";

import { callHostRpc } from "#/host/client";

/** Every filled region on each view, stamped or not: what the adopt pane may offer. */
export async function readCandidates(
  target: DocumentRef,
  views: readonly string[],
): Promise<CandidateRegion[]> {
  const read = await Promise.all(
    views.map((view) =>
      callHostRpc(
        "takeoffs.candidates",
        { view },
        { bridgeSessionId: target.session, openDocumentId: target.openId },
      ),
    ),
  );
  return candidateRegionSchema.array().parse(
    read.flatMap(({ regions }) =>
      regions.map((region) => ({
        ...region,
        role: region.role ?? null,
        guid: region.guid ?? null,
      })),
    ),
  );
}
