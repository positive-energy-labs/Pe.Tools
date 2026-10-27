import type { RevitDetailSpaceScene } from "@pe/host-contracts/generated";
export type ContextRepresentation = RevitDetailSpaceScene.Req.SceneContextRepresentation;
/** `revit.detail.space-scene`'s request: capture the named host elements (and, unless `focusOnly`,
 * what is around them) into a PSC1 artifact on the host. Space and ducts both ask with this. */
export const sceneRequest = (
  elementIds: readonly number[],
  focusOnly = true,
  contextPaddingFt = 15,
  proximity = false,
  contextRepresentation: ContextRepresentation = "boxes",
) => {
  if (elementIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw Error("Use positive host element ids separated by commas");
  if (focusOnly && !elementIds.length) throw Error("Choose host element ids to inspect");
  return {
    elementIds: [...elementIds],
    contextPaddingFt,
    maxTriangles: 1_500_000,
    focusOnly,
    proximity,
    contextRepresentation: focusOnly ? ("none" as const) : contextRepresentation,
  };
};
