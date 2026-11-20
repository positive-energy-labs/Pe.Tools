import type { Effect, FileSystem } from "effect";

export type RunPods = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem>,
  options?: { signal?: AbortSignal },
) => Promise<A>;
