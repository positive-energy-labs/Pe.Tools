/**
 * One captured scene, decoded: `revit.detail.space-scene` for the request (one host call per new
 * request or refresh, never per render), then its PSC1 artifact fetched and decoded once into a
 * resident cache shared by every mount. Null request reads nothing.
 */
import { useEffect, useState } from "react";

import { useHostOp } from "#/readings";
import { NATIVE_READ_WAIT_S } from "#/route/waits";
import { fetchSceneArtifact } from "./artifact";
import { sceneRequest } from "./host";
import { decodeScene, type Psc1Metadata } from "./psc1";
import { SceneCache } from "./scene-cache";
import type { SceneMeshes } from "./types";

type Decoded = { metadata: Psc1Metadata; positions: Float32Array; meshes: SceneMeshes };
const cache = new SceneCache<Decoded>();
/** What the disabled call carries: never sent. */
const IDLE = sceneRequest([], false);

export type SceneRead = {
  meshes: SceneMeshes | null;
  /** Why there are no meshes: the capture or the artifact failed; null otherwise. */
  error: string | null;
  pending: boolean;
};

export function useScene(
  request: ReturnType<typeof sceneRequest> | null,
  doc: { session: string; openId: string } | null,
  epoch: number,
): SceneRead {
  const call = useHostOp("revit.detail.space-scene", request ?? IDLE, {
    bridgeSessionId: doc?.session,
    openDocumentId: doc?.openId,
    enabled: request !== null && doc !== null,
    waitSeconds: NATIVE_READ_WAIT_S,
  });
  const { refresh } = call;
  useEffect(() => {
    if (epoch > 0) refresh();
  }, [epoch, refresh]);
  const id = request && doc ? (call.data?.id ?? null) : null;
  const [loaded, setLoaded] = useState<{ id: string; meshes?: SceneMeshes; error?: string } | null>(
    null,
  );
  useEffect(() => {
    if (!id) return;
    const resident = cache.get(id);
    if (resident) return setLoaded({ id, meshes: resident.data.meshes });
    const abort = new AbortController();
    fetchSceneArtifact(id, abort.signal)
      .then((buffer) => {
        const { metadata, meshes } = decodeScene(buffer);
        cache.put(id, { metadata, positions: meshes.positions, meshes });
        setLoaded({ id, meshes });
      })
      .catch((e: unknown) => abort.signal.aborted || setLoaded({ id, error: String(e) }));
    return () => abort.abort();
  }, [id]);
  const here = loaded?.id === id ? loaded : null;
  return {
    meshes: (id && here?.meshes) || null,
    error: request ? (call.error?.message ?? here?.error ?? null) : null,
    pending: !!request && !!doc && (call.pending || (!!id && !here)),
  };
}
