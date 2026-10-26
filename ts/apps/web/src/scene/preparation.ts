import { paintOf, type Look } from "./grounds";
import type { PaintOf, SceneMeshes } from "./types";
import { prepareGeometry, type PreparationInput, type PreparedGeometry } from "./prepare-geometry";
import { preparedGet, preparedKey, preparedPut } from "./prepared-cache";

/** One cancellable preparation per viewport. Superseded work cannot publish or keep a worker alive. */
export function scenePreparation() {
  let cancel = () => {};
  return {
    stop() {
      cancel();
    },
    async prepare(
      meshes: SceneMeshes,
      paint: PaintOf | undefined,
      look: Look,
      signal: AbortSignal,
    ): Promise<PreparedGeometry> {
      cancel();
      signal.throwIfAborted();
      const paints = meshes.instances.map((i) => paintOf(i, paint));
      const input: PreparationInput = {
        positions: meshes.positions,
        bounds: meshes.bounds,
        instances: meshes.instances,
        cuts: meshes.cuts,
        subjects: paints.map((p) => p.tier === "subject"),
        angles: paints.map((p) =>
          p.tier === "context"
            ? null
            : p.surface === "shell"
              ? look.shell.edgeAngle
              : p.tier === "subject"
                ? look.routes.edgeAngle
                : null,
        ),
      };
      if (!meshes.instances.length) return prepareGeometry(input);
      const key = preparedKey(meshes, JSON.stringify([input.subjects, input.angles]));
      const held = preparedGet(key);
      if (held) return held;
      return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./prepare.worker.ts", import.meta.url), {
          type: "module",
        });
        const close = () => {
          worker.onmessage = null;
          worker.onerror = null;
          worker.terminate();
          signal.removeEventListener("abort", aborted);
          cancel = () => {};
        };
        const aborted = () => {
          close();
          reject(new DOMException("Scene preparation superseded", "AbortError"));
        };
        cancel = aborted;
        signal.addEventListener("abort", aborted, { once: true });
        worker.onerror = (event) => {
          close();
          reject(Error(event.message));
        };
        worker.onmessage = ({
          data,
        }: MessageEvent<{ result?: PreparedGeometry; error?: string }>) => {
          close();
          if (data.result) {
            preparedPut(
              key,
              data.result,
              meshes.instances.some((i) => !i.focus),
            );
            resolve(data.result);
          } else reject(Error(data.error ?? "Scene preparation returned no geometry"));
        };
        // Structured clone owns the worker input. Never detach the artifact used by picking or another viewport.
        worker.postMessage(input);
      });
    },
  };
}
