/**
 * THE LEVEL'S PLAN IMAGE: the one reader of a level's view image on /takeoffs. The host answers
 * `revit.context.view-image` with a registration (Revit's frame, never re-derived here) and an
 * `imageUrl` that is non-null exactly when the registration is; without one it names why.
 */
import type { TargetResolution } from "@pe/agent-contracts";

import { readOwnerCrops } from "#/takeoff/host";
import { HOST_QUERY_KEY, useHostCall, useHostOp } from "#/readings";

export { PLAN_REFUSAL, planView, levelsOf } from "./plan";
export type { PlanRefusal, OwnerCrop, DrawnZone } from "./plan";
import { planOf } from "./plan";
/** Each region's `ownerCrop`, by `view:elementId`, read from `takeoffs.candidates` on its owner views. */
export function useOwnerCrops(resolution: TargetResolution, views: readonly string[]) {
  const document =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : undefined;
  const owners = [...new Set(views)].sort();
  const call = useHostCall(
    () => readOwnerCrops(document!, owners),
    [...HOST_QUERY_KEY, "owner-crops", document?.session ?? "", document?.openId ?? "", ...owners],
    Boolean(document && owners.length),
  );
  return { crops: call.data ?? null, error: call.error?.message ?? null };
}

/** Each level once, in lane order: a lane is a view, and many views share a level (29). */
/** `pixelSize`: the exported image's long side; absent, the host's default. */
export function usePlanImage(
  resolution: TargetResolution,
  view: string | undefined,
  pixelSize?: number,
) {
  const document =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : undefined;
  const call = useHostOp(
    "revit.context.view-image",
    { target: { name: view ?? "" }, ...(pixelSize ? { pixelSize } : {}) },
    {
      bridgeSessionId: document?.session,
      openDocumentId: document?.openId,
      enabled: Boolean(document && view),
    },
  );
  return {
    image: call.data ? planOf(call.data) : null,
    error: call.error?.message ?? null,
  };
}
