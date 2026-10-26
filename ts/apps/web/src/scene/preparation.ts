import type { ScenePlan } from "./scene-plan";
import { prepareGeometry, type PreparationInput, type PreparedGeometry } from "./prepare-geometry";
import { sceneMemory } from "./scene-memory";
import { preparedCache, preparedFootprint } from "./prepared-cache";

/** The caller owns cancellation; this function owns only its worker's lifetime. */
export async function prepareScene(
  plan: ScenePlan,
  signal: AbortSignal,
): Promise<{ geometry: PreparedGeometry; release(): void }> {
  signal.throwIfAborted();
  const { meshes } = plan;
  const input: PreparationInput = {
    positions: meshes.positions,
    bounds: meshes.bounds,
    instances: meshes.instances,
    cuts: meshes.cuts,
    subjects: plan.roles.map((p) => p.tier === "subject"),
    angles: plan.angles,
  };
  const own = (
    geometry: PreparedGeometry,
    lease = sceneMemory.acquire("prepared", preparedFootprint(geometry)),
  ) => ({
    geometry,
    release: () => lease.release(),
  });
  if (!meshes.instances.length) return own(prepareGeometry(input));
  const key = preparedCache.key(meshes, JSON.stringify([input.subjects, input.angles]));
  const held = preparedCache.get(key);
  if (held) return own(held);
  // Structured-clone input + output arrays + worst-case edge pairs + bounded veil scratch.
  // This is an explicit transient estimate, not a measurement of worker heap or driver memory.
  const reservation = sceneMemory.reserve("prepared", {
    jsBufferBytes:
      meshes.positions.buffer.byteLength +
      Math.ceil(meshes.positions.byteLength * (2 + 1 / 3)) +
      meshes.instances.reduce(
        (bytes, instance, i) =>
          bytes + (plan.angles[i] === null ? 0 : instance.vertexCount * 3 * 4 * 2),
        0,
      ) +
      9 * 2 ** 21,
    jsHeapEstimateBytes: meshes.instances.length * 512,
  });
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./prepare.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      reservation.release();
      reject(error);
      return;
    }
    const close = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      signal.removeEventListener("abort", aborted);
    };
    const aborted = () => {
      close();
      reservation.release();
      reject(new DOMException("Scene preparation superseded", "AbortError"));
    };
    signal.addEventListener("abort", aborted, { once: true });
    worker.onerror = (event) => {
      close();
      reservation.release();
      reject(Error(event.message));
    };
    worker.onmessage = ({ data }: MessageEvent<{ result?: PreparedGeometry; error?: string }>) => {
      close();
      if (data.result) {
        const lease = reservation.commit(preparedFootprint(data.result));
        preparedCache.put(
          key,
          data.result,
          meshes.instances.some((i) => !i.focus),
        );
        resolve(own(data.result, lease));
      } else {
        reservation.release();
        reject(Error(data.error ?? "Scene preparation returned no geometry"));
      }
    };
    // Structured clone owns the worker input. Never detach the artifact used by picking or another viewport.
    try {
      worker.postMessage(input);
    } catch (error) {
      close();
      reservation.release();
      reject(error);
    }
  });
}
