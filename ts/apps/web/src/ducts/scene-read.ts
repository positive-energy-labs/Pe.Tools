import { useEffect, useMemo, useRef } from "react";
import { useScene, type SceneRead } from "#/scene/use-scene";
import { retainSceneMeshes } from "#/scene/scene-data";
import { clipMeshes } from "#/scene/clip";
import type { SceneMeshes } from "#/scene/types";
import { sceneRequest } from "#/scene/host";
type CaptureRequest = ReturnType<typeof sceneRequest>;
const EMPTY_CUTS: SceneMeshes["cuts"] = new Map();
const coverages = new Map<string, CaptureRequest>();
function retain<T>(entries: Map<string, T>, key: string, value: T): T {
  entries.delete(key);
  entries.set(key, value);
  if (entries.size > 32) entries.delete(entries.keys().next().value!);
  return value;
}

/** N6: retain drawing data by bound document, even while native action authority is withdrawn. */
export function usePictureRead(
  capture: SceneRead,
  key: string | null,
  system: string,
  refreshing: boolean,
) {
  const last = useRef<{ key: string; system: string; read: SceneRead } | null>(null);
  if (last.current?.key !== key) last.current = null;
  if (capture.meshes && key) last.current = { key, system, read: capture };
  const retained = last.current?.read;
  useEffect(() => {
    const lease = retainSceneMeshes([retained?.meshes, retained?.focusMeshes]);
    return () => lease.release();
  }, [retained?.meshes, retained?.focusMeshes]);
  const holding = !capture.meshes ? last.current : null;
  const pending = capture.pending || refreshing;
  return {
    holding: pending ? holding : null,
    read: {
      ...(holding?.read ?? capture),
      error: capture.error,
      pending,
      // A current focus may be inspected while pricing refreshes. Native action authority
      // still belongs to NativeObservationScope, which independently withdraws it.
      focusReady: !!capture.meshes && capture.focusReady,
    },
  };
}

/** Focus owns the first frame. Coverage grows only within one document/revision/membership. */
export function useDuctScene(
  request: ReturnType<typeof sceneRequest> | null,
  doc: { session: string; openId: string } | null,
  epoch: number | string,
  cuts: SceneMeshes["cuts"] = EMPTY_CUTS,
): SceneRead {
  const identity = JSON.stringify([
    doc?.session,
    doc?.openId,
    epoch,
    request?.elementIds,
    request?.maxTriangles,
  ]);
  let coverage = coverages.get(identity) ?? null;
  if (request && !request.focusOnly) {
    coverage = retain(coverages, identity, {
      ...request,
      proximity: request.proximity && (coverage?.proximity ?? true),
      contextPaddingFt: Math.max(request.contextPaddingFt, coverage?.contextPaddingFt ?? 0),
    });
  }
  const focus = useScene(
    request ? { ...request, focusOnly: true, proximity: false, contextPaddingFt: 0 } : null,
    doc,
    epoch,
  );
  // Do not queue optional geometry before exact focus has reached the browser.
  const context = useScene(focus.meshes ? coverage : null, doc, epoch);
  const focusMeshes = useMemo(
    () => (focus.meshes ? clipMeshes(focus.meshes, cuts) : null),
    [focus.meshes, cuts],
  );
  const contextMeshes = useMemo(
    () => (context.meshes ? clipMeshes(context.meshes, cuts) : null),
    [context.meshes, cuts],
  );
  if (!request || request.focusOnly) return { ...focus, meshes: focusMeshes };
  const shown = context.meshes ? context : focus;
  return {
    ...shown,
    meshes: contextMeshes ?? focusMeshes,
    error: focus.error ?? context.error,
    pending: focus.pending || context.pending,
    focusReady: !!focus.meshes && !focus.pending,
    focusMeshes,
  };
}
