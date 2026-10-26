/**
 * One captured scene, decoded: `revit.detail.space-scene` for the request (one host call per new
 * request or refresh, never per render), then its PSC1 artifact fetched and decoded once into a
 * resident cache shared by every mount. Null request reads nothing. `useSceneArtifact` is the
 * second half alone: a saved scene by its id, with no capture.
 */
import { useEffect, useRef, useState } from "react";

import { useHostCall } from "#/readings";
import { callHostRpc } from "#/host/client";
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
type CaptureRequest = ReturnType<typeof sceneRequest>;
// Receipts are reusable only under an explicit native observation revision, never elapsed time.
const captures = new Map<string, Promise<{ id: string }>>();
const coverages = new Map<string, CaptureRequest>();
function retain<T>(entries: Map<string, T>, key: string, value: T): T {
  entries.delete(key);
  entries.set(key, value);
  if (entries.size > 32) entries.delete(entries.keys().next().value!);
  return value;
}

export type SceneRead = {
  meshes: SceneMeshes | null;
  /** Why there are no meshes: the capture or the artifact failed; null otherwise. */
  error: string | null;
  pending: boolean;
  /** Current-scope exact focus is usable while its optional context is pending. */
  focusReady?: boolean;
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
    true,
  );
  // Do not queue optional geometry before exact focus has reached the browser.
  const context = useScene(focus.meshes ? coverage : null, doc, epoch, true);
  if (!request || request.focusOnly) return focus;
  const shown = context.meshes ? context : focus;
  return {
    ...shown,
    error: focus.error ?? context.error,
    pending: focus.pending || context.pending,
    focusReady: !!focus.meshes && !focus.pending,
  };
}

export function useScene(
  request: ReturnType<typeof sceneRequest> | null,
  doc: { session: string; openId: string } | null,
  epoch: number | string,
  reuse = false,
): SceneRead {
  const key = JSON.stringify([doc?.session, doc?.openId, epoch, request]);
  const call = useHostCall(
    async (signal) => {
      const resident = reuse ? captures.get(key) : undefined;
      if (resident) return retain(captures, key, resident);
      const capture = callHostRpc("revit.detail.space-scene", request ?? IDLE, {
        bridgeSessionId: doc?.session,
        openDocumentId: doc?.openId,
        signal,
      }).then(({ id }) => ({ id }));
      if (reuse) {
        retain(captures, key, capture);
        void capture.catch(() => {
          if (captures.get(key) === capture) captures.delete(key);
        });
      }
      return capture;
    },
    ["space-scene", key],
    request !== null && doc !== null,
    NATIVE_READ_WAIT_S,
    true,
  );
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
