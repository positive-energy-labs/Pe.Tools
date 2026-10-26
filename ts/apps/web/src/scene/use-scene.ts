/**
 * One captured scene, decoded: `revit.detail.space-scene` for the request (one host call per new
 * request or refresh, never per render), then its PSC1 artifact fetched and decoded once into a
 * resident cache shared by every mount. Null request reads nothing. `useSceneArtifact` is the
 * second half alone: a saved scene by its id, with no capture.
 */
import { useEffect, useRef, useState } from "react";

import { useHostOp } from "#/readings";
import { NATIVE_READ_WAIT_S } from "#/route/waits";
import { fetchSceneArtifact } from "./artifact";
import { sceneRequest } from "./host";
import { decodeScene, type Psc1Metadata } from "./psc1";
import { SceneCache } from "./scene-cache";
import type { SceneMeshes } from "./types";

type Decoded = { metadata: Psc1Metadata; positions: Float32Array; meshes: SceneMeshes };
const cache = new SceneCache<Decoded>();
type SceneLoad = { users: number; abort: AbortController; data: Promise<Decoded> };
const loads = new Map<string, SceneLoad>();

/** Active consumers share identity even if the LRU evicts their scene. The last release owns abort. */
function acquireScene(id: string) {
  let load = loads.get(id);
  if (!load) {
    const abort = new AbortController();
    const resident = cache.get(id);
    const next: SceneLoad = {
      users: 0,
      abort,
      data: resident
        ? Promise.resolve(resident.data)
        : fetchSceneArtifact(id, abort.signal).then((buffer) => {
            // Fetch adapters may finish after cancellation; never decode or cache an abandoned read.
            if (abort.signal.aborted || next.users === 0)
              throw new DOMException("Scene read released", "AbortError");
            const { metadata, meshes } = decodeScene(buffer);
            const data = { metadata, positions: meshes.positions, meshes };
            cache.put(id, data);
            return data;
          }),
    };
    loads.set(id, (load = next));
  }
  const held = load;
  held.users++;
  return {
    data: held.data,
    release() {
      held.users--;
      // StrictMode reconnects effects synchronously; it must not restart a shared download.
      queueMicrotask(() => {
        if (held.users || loads.get(id) !== held) return;
        loads.delete(id);
        held.abort.abort();
      });
    },
  };
}
/** What the disabled call carries: never sent. */
const IDLE = sceneRequest([], false);

export type SceneRead = {
  meshes: SceneMeshes | null;
  /** Why there are no meshes: the capture or the artifact failed; null otherwise. */
  error: string | null;
  pending: boolean;
  omittedElements: number;
  unavailableElements: number;
};

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
  const holding = !capture.meshes ? last.current : null;
  const pending = capture.pending || refreshing;
  return {
    holding: pending ? holding : null,
    read: {
      ...(holding?.read ?? capture),
      error: capture.error,
      pending,
    },
  };
}

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
  const artifact = useSceneArtifact(id);
  return {
    meshes: artifact.meshes,
    error: request ? (call.error?.message ?? artifact.error) : null,
    pending: !!request && !!doc && (call.pending || artifact.pending),
    omittedElements: artifact.metadata?.omittedElements ?? 0,
    unavailableElements: artifact.metadata?.unavailableElements.length ?? 0,
  };
}

export type ArtifactRead = {
  meshes: SceneMeshes | null;
  metadata: Psc1Metadata | null;
  error: string | null;
  pending: boolean;
};

/** One saved scene by its artifact id, fetched and decoded once into the shared cache. */
export function useSceneArtifact(id: string | null): ArtifactRead {
  const [loaded, setLoaded] = useState<{ id: string; data?: Decoded; error?: string } | null>(null);
  useEffect(() => {
    // An idle or changed address must release its previous hook-owned buffer, not just hide it.
    setLoaded(null);
    if (!id) return;
    const scene = acquireScene(id);
    let active = true;
    scene.data
      .then((data) => active && setLoaded({ id, data }))
      .catch((e: unknown) => active && setLoaded({ id, error: String(e) }));
    return () => {
      active = false;
      scene.release();
    };
  }, [id]);
  const here = id && loaded?.id === id ? loaded : null;
  return {
    meshes: here?.data?.meshes ?? null,
    metadata: here?.data?.metadata ?? null,
    error: here?.error ?? null,
    pending: !!id && !here,
  };
}
