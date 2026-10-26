import { sceneMemory } from "./scene-memory";
export const sceneDiagnostics = () => ({
  memory: sceneMemory.snapshot(),
  measured: ["Owned ArrayBuffer backing sizes; globally deduplicated by identity"],
  estimated: [
    "Decoded/prepared metadata and cache keys",
    "Worker clone/output/scratch reservations",
    "Per-context geometry/texture GPU payload bytes",
  ],
  untracked: [
    "Driver VRAM, shader programs and allocation overhead",
    "Framebuffer/render-target allocations",
    "Browser/React/transport and general Three object heap",
    "GC timing after ownership release",
  ],
  policy:
    "512MiB decoded artifact admission proxy; active workspace may exceed it. Not a process-memory or VRAM cap.",
});
