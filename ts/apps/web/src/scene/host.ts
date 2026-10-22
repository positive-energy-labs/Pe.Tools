/** `revit.detail.space-scene`'s request: capture the named host elements (and, unless `focusOnly`,
 * what is around them) into a PSC1 artifact on the host. Space and ducts both ask with this. */
export const sceneRequest = (elementIds: readonly number[], focusOnly = true) => {
  if (elementIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw Error("Use positive host element ids separated by commas");
  if (focusOnly && !elementIds.length) throw Error("Choose host element ids to inspect");
  return { elementIds: [...elementIds], contextPaddingFt: 15, maxTriangles: 1_500_000, focusOnly };
};
