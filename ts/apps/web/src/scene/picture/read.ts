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
export function useCapture(
  request: ReturnType<typeof sceneRequest> | null,
  doc: { session: string; openId: string } | null,
  epoch: number | string,
  cuts: SceneMeshes["cuts"] = EMPTY_CUTS,
  overviewRequest: CaptureRequest | null = null,
): SceneRead {
  if (
    request &&
    (request.contextRepresentation === "meshes" || request.contextRepresentation === "none")
  )
    request = { ...request, contextPaddingFt: Math.max(5, request.contextPaddingFt) };
  const overview = request?.contextRepresentation === "overview";
  const staged = !overview && !!request && !!overviewRequest;
  // The overview already carries focus bounds and zero-tessellation drawing data. An explicit
  // detailed read replaces it directly; do not warm focus through a second native read.
  const declared = useScene(overview ? request : null, doc, epoch);
  const overviewKey = JSON.stringify([doc, epoch, overviewRequest]);
  const priorOverview = useRef<{ key: string; read: SceneRead } | null>(null);
  if (priorOverview.current?.key !== overviewKey) priorOverview.current = null;
  if (overview && declared.meshes) priorOverview.current = { key: overviewKey, read: declared };
  // Keep only a completed overview. Leaving its subscription also releases a pending overview
  // when the person supersedes it with Read detailed.
  const preview = staged ? (priorOverview.current?.read ?? declared) : declared;
  const activeRequest = request;
  request = overview ? null : request;
  const identity = JSON.stringify([
    doc?.session,
    doc?.openId,
    epoch,
    request?.elementIds,
    request?.maxTriangles,
    request?.contextRepresentation,
  ]);
  let coverage = coverages.get(identity) ?? null;
  if (request && !request.focusOnly) {
    coverage = {
      ...request,
      contextPaddingFt: Math.max(request.contextPaddingFt, coverage?.contextPaddingFt ?? 0),
    };
  }
  const focus = useScene(
    request && !staged
      ? {
          ...request,
          focusOnly: true,
          contextPaddingFt: 5,
          contextRepresentation: request.contextRepresentation === "overview" ? "overview" : "none",
        }
      : null,
    doc,
    epoch,
  );
  // Callers without an overview still stage exact focus first. Picture replaces its overview directly.
  const context = useScene(staged ? request : focus.meshes ? coverage : null, doc, epoch);
  useEffect(() => {
    if (coverage && context.meshes && context.completeness?.complete)
      retain(coverages, identity, coverage);
  }, [identity, coverage, context.meshes, context.completeness]);
  const focusMeshes = useMemo(
    () => (focus.meshes ? clipMeshes(focus.meshes, cuts) : null),
    [focus.meshes, cuts],
  );
  const contextMeshes = useMemo(
    () => (context.meshes ? clipMeshes(context.meshes, cuts) : null),
    [context.meshes, cuts],
  );
  const declaredMeshes = useMemo(
    () => (preview.meshes ? clipMeshes(preview.meshes, cuts) : null),
    [preview.meshes, cuts],
  );
  if (staged)
    return {
      ...(context.meshes ? context : preview),
      meshes: contextMeshes ?? declaredMeshes,
      focusMeshes: declaredMeshes,
      focusReady: !!declaredMeshes,
      pending: context.pending,
      error: preview.error,
      contextError: context.error,
    };
  if (overview && activeRequest)
    return { ...declared, meshes: declaredMeshes, focusReady: !!declaredMeshes };
  if (!request || request.focusOnly) return { ...focus, meshes: focusMeshes };
  const shown = context.meshes ? context : focus;
  return {
    ...shown,
    meshes: contextMeshes ?? focusMeshes,
    error: focus.error,
    contextError: context.error,
    pending: focus.pending || context.pending,
    focusReady: !!focus.meshes && !focus.pending,
    focusMeshes,
  };
}
