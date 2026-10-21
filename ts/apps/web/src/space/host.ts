import { callHostRpc, type HostCallOptions } from "#/host/client";

export function captureScene(ids: string, scope: HostCallOptions) {
  const elementIds = ids.trim()
    ? ids
        .trim()
        .split(/[\s,]+/)
        .map(Number)
    : [];
  if (elementIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw Error("Use positive host element ids separated by commas");
  return callHostRpc(
    "revit.detail.space-scene",
    {
      elementIds,
      contextPaddingFt: 15,
      maxTriangles: 1500000,
    },
    scope,
  );
}
