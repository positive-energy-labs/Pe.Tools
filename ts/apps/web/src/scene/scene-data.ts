import { NATIVE_READ_WAIT_S } from "#/route/waits";
import { callHostRpc } from "#/host/client";
import { HostCallError } from "@pe/host-contracts/operation-types";
import { fetchSceneArtifact } from "./artifact";
import { decodeScene, SCENE_FORMAT, type Psc1Metadata } from "./psc1";
import { SceneCache, sceneFootprint } from "./scene-cache";
import { sceneMemory, type SceneMemoryLease } from "./scene-memory";
import type { SceneMeshes } from "./types";
import type { sceneRequest } from "./host";

export type SceneSource =
  | { kind: "artifact"; id: string }
  | {
      kind: "capture";
      document: { session: string; openId: string };
      revision: string | number;
      request: ReturnType<typeof sceneRequest>;
    };
type Decoded = { metadata: Psc1Metadata; positions: Float32Array; meshes: SceneMeshes };
export type SourceSnapshot =
  | { state: "pending" }
  | { state: "ready"; data: Decoded }
  | { state: "failed"; error: string };
const PENDING: SourceSnapshot = { state: "pending" };
/** A refused Revit queue (`BridgeBusy`, not dispatched) is transient: resend 1 s, doubling to 15 s,
 * until the read's own deadline. Any other refusal or failure is final. */
const BUSY_RETRY_FIRST_MS = 1_000;
const BUSY_RETRY_CEILING_MS = 15_000;
const isBridgeBusy = (error: unknown) =>
  error instanceof HostCallError && error.problem?.kind === "BridgeBusy";
const cache = new SceneCache<Decoded>();
const receipts = new Map<string, string>();
const sources = new Map<string, SceneData>();
const identity = (source: SceneSource) =>
  source.kind === "artifact"
    ? `artifact:${source.id}`
    : JSON.stringify([
        SCENE_FORMAT,
        source.document.session,
        source.document.openId,
        source.revision,
        source.request,
      ]);

/** Freshness belongs to the exact source identity; there is no elapsed-time substitute for a revision.
 * Subscriptions lease immutable data. The last subscriber owns cancellation, including StrictMode reconnects. */
class SceneData {
  private listeners = new Set<() => void>();
  private current: SourceSnapshot = PENDING;
  private owned: { abort: AbortController; release: () => void } | null = null;
  constructor(
    private readonly source: SceneSource,
    private readonly key: string,
  ) {}
  private artifactId() {
    return this.source.kind === "artifact" ? this.source.id : receipts.get(this.key);
  }
  read = (): SourceSnapshot => {
    if (!this.owned) {
      const id = this.artifactId(),
        data = id ? cache.get(id)?.data : undefined;
      if (data && (this.current.state !== "ready" || this.current.data !== data))
        this.current = { state: "ready", data };
      if (!data) this.current = PENDING;
    }
    return this.current;
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.owned) this.start();
    return () => {
      this.listeners.delete(listener);
      queueMicrotask(() => {
        if (this.listeners.size) return;
        this.owned?.abort.abort();
        this.owned?.release();
        this.owned = null;
        this.current = PENDING;
        // Inactive addresses hold neither buffers nor request descriptors indefinitely.
        if (sources.get(this.key) === this) sources.delete(this.key);
      });
    };
  };
  private publish(snapshot: SourceSnapshot) {
    this.current = snapshot;
    for (const listener of this.listeners) listener();
  }
  private start() {
    const abort = new AbortController();
    const owned = { abort, release: () => {} };
    this.owned = owned;
    const publish = (snapshot: SourceSnapshot) => {
      if (!abort.signal.aborted && this.owned === owned) this.publish(snapshot);
    };
    if (this.source.kind === "capture") {
      const follow = (id: string) => {
        abort.signal.throwIfAborted();
        const artifact = sceneData({ kind: "artifact", id });
        owned.release = artifact.subscribe(() => publish(artifact.read()));
        publish(artifact.read());
      };
      const id = this.artifactId();
      if (id) {
        follow(id);
        return;
      }
      const source = this.source;
      // One deadline bounds the whole read, including every busy resend: a refusal is not an answer.
      let retry: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => {
        publish({ state: "failed", error: `no answer after ${NATIVE_READ_WAIT_S}s` });
        abort.abort();
      }, NATIVE_READ_WAIT_S * 1000);
      owned.release = () => {
        clearTimeout(timeout);
        clearTimeout(retry);
      };
      const send = (delay: number) => {
        if (abort.signal.aborted) return;
        void callHostRpc("revit.detail.space-scene", source.request, {
          bridgeSessionId: source.document.session,
          openDocumentId: source.document.openId,
          signal: abort.signal,
        })
          .then(({ id }) => {
            clearTimeout(timeout);
            abort.signal.throwIfAborted();
            receipts.delete(this.key);
            receipts.set(this.key, id);
            if (receipts.size > 32) receipts.delete(receipts.keys().next().value!);
            follow(id);
          })
          .catch((error: unknown) => {
            if (abort.signal.aborted) return;
            if (isBridgeBusy(error)) {
              retry = setTimeout(() => send(Math.min(BUSY_RETRY_CEILING_MS, delay * 2)), delay);
              return;
            }
            clearTimeout(timeout);
            publish({ state: "failed", error: String(error) });
          });
      };
      send(BUSY_RETRY_FIRST_MS);
      return;
    }
    const id = this.source.id;
    const resident = cache.get(id);
    let lease: SceneMemoryLease | undefined;
    owned.release = () => lease?.release();
    if (resident) {
      lease = resident.acquire();
      publish({ state: "ready", data: resident.data });
      return;
    }
    void fetchSceneArtifact(id, abort.signal)
      .then((buffer) => {
        abort.signal.throwIfAborted();
        // Account the whole transport backing before decode/admission can fail.
        lease = sceneMemory.acquire("decoded", { buffers: [buffer] });
        const { metadata, meshes } = decodeScene(buffer);
        const data = { metadata, positions: meshes.positions, meshes };
        lease.update(sceneFootprint(data));
        cache.put(id, data);
        publish({ state: "ready", data });
      })
      .catch((error: unknown) => {
        lease?.release();
        publish({ state: "failed", error: String(error) });
      });
  }
}
export function sceneData(source: SceneSource) {
  const key = identity(source);
  let data = sources.get(key);
  if (!data) sources.set(key, (data = new SceneData(source, key)));
  return data;
}

/** A domain can keep a clipped/read-only picture while it withdraws action authority or hides
 * its viewport. That CPU lifetime is a data lease, independent of renderer admission/disposal. */
export function retainSceneMeshes(meshes: readonly (SceneMeshes | null | undefined)[]) {
  return sceneMemory.acquire("decoded", {
    buffers: meshes.flatMap((mesh) => (mesh ? [mesh.positions.buffer] : [])),
  });
}
