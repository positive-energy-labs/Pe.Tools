import { useMemo, useSyncExternalStore } from "react";
import { sceneData, type SceneSource, type SourceSnapshot } from "./scene-data";
import type { sceneRequest } from "./host";
import type { SceneMeshes } from "./types";
import type { Psc1Metadata } from "./psc1";

export type SceneRead = {
  meshes: SceneMeshes | null;
  /** Why there are no meshes: the capture or the artifact failed; null otherwise. */
  error: string | null;
  pending: boolean;
  /** Current-scope exact focus is usable while its optional context is pending. */
  focusReady?: boolean;
  /** Exact focus owner, stable while its optional context changes. Also the first staged picture. */
  focusMeshes?: SceneMeshes | null;
  omittedElements: number;
  unavailableElements: number;
  completeness: Psc1Metadata["completeness"] | null;
  levels?: Psc1Metadata["levels"] | null;
  /** Optional context failed; the exact focus remains usable. */
  contextError?: string | null;
};

const idle = { meshes: null, metadata: null, error: null, pending: false };
const empty = () => null;
const unsubscribe = () => () => {};
function useSource(source: SceneSource | null): ArtifactRead {
  const key = JSON.stringify(source);
  const data = useMemo(() => (source ? sceneData(source) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const snapshot: SourceSnapshot | null = useSyncExternalStore(
    data?.subscribe ?? unsubscribe,
    data?.read ?? empty,
    data?.read ?? empty,
  );
  if (!snapshot) return idle;
  return {
    meshes: snapshot.state === "ready" ? snapshot.data.meshes : null,
    metadata: snapshot.state === "ready" ? snapshot.data.metadata : null,
    error: snapshot.state === "failed" ? snapshot.error : null,
    pending: snapshot.state === "pending",
  };
}
/** React declares an exact requested view and subscribes; the shared data owner executes it. */
export function useScene(
  request: ReturnType<typeof sceneRequest> | null,
  document: { session: string; openId: string } | null,
  revision: number | string,
): SceneRead {
  const read = useSource(
    request && document ? { kind: "capture", request, document, revision } : null,
  );
  return {
    meshes: read.meshes,
    error: read.error,
    pending: read.pending,
    omittedElements: read.metadata?.omittedElements ?? 0,
    unavailableElements: read.metadata?.unavailableElements.length ?? 0,
    completeness: read.metadata?.completeness ?? null,
    levels: read.metadata?.levels ?? null,
  };
}
export type ArtifactRead = {
  meshes: SceneMeshes | null;
  metadata: Psc1Metadata | null;
  error: string | null;
  pending: boolean;
};
export function useSceneArtifact(id: string | null): ArtifactRead {
  return useSource(id ? { kind: "artifact", id } : null);
}
