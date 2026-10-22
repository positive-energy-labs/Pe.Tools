/** `revit.detail.space-scene`: capture the named host elements (and, unless `focusOnly`, what is
 * around them) into a PSC1 artifact on the host. Space and ducts both ask through here. */
import { callHostRpc, type HostCallOptions } from "#/host/client";

export const sceneRequest = (elementIds: readonly number[], focusOnly = true) => {
  if (elementIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw Error("Use positive host element ids separated by commas");
  if (focusOnly && !elementIds.length) throw Error("Choose host element ids to inspect");
  return { elementIds: [...elementIds], contextPaddingFt: 15, maxTriangles: 1_500_000, focusOnly };
};

export const captureScene = (
  elementIds: readonly number[],
  scope: HostCallOptions,
  focusOnly = true,
) => callHostRpc("revit.detail.space-scene", sceneRequest(elementIds, focusOnly), scope);
