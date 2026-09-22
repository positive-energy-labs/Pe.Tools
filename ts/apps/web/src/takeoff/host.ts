/** `/takeoffs`' own host reads: the one place below the route that reaches the host (§7). */
import { candidateRegionSchema, type CandidateRegion, type DocumentRef } from "@pe/agent-contracts";

import { callHostRpc } from "#/host/client";
import type { OwnerCrop } from "#/takeoff/plan-image";

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

/** Each region's `ownerCrop` by `view:elementId`, from `takeoffs.candidates` on its owner views. */
export async function readOwnerCrops(target: DocumentRef, views: readonly string[]) {
  const crops = new Map<string, OwnerCrop | null>();
  for (const view of views) {
    const read = await callHostRpc(
      "takeoffs.candidates",
      { view },
      { bridgeSessionId: target.session, openDocumentId: target.openId },
    );
    for (const region of read.regions)
      crops.set(`${view}:${region.elementId}`, region.ownerCrop ?? null);
  }
  return crops;
}
