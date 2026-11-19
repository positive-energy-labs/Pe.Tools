import { NodeFileSystem } from "@effect/platform-node";
import { Effect, type FileSystem } from "effect";

export type PodRunner = {
  runPods?: <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>, options?: { signal?: AbortSignal }) => Promise<A>;
};

export const runPods = <A, E>(
  deps: PodRunner,
  effect: Effect.Effect<A, E, FileSystem.FileSystem>,
  options?: { signal?: AbortSignal },
) =>
  deps.runPods
    ? deps.runPods(effect, options)
    : // effect-edge: island, phase 5
      Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)), options);
