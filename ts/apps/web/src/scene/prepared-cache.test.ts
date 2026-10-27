import { describe, expect, it } from "vite-plus/test";
import { PreparedCache, preparedFootprint } from "./prepared-cache";
import { SceneCache, sceneAdmissionBytes, type SceneData } from "./scene-cache";
import { SceneMemory } from "./scene-memory";
import type { PreparedGeometry } from "./prepare-geometry";
import { SceneMeshes } from "./types";

const prepared = (buffer = new ArrayBuffer(100)): PreparedGeometry => ({
  positions: new Float32Array(buffer, 0, 3),
  normals: new Float32Array(buffer, 12, 3),
  continuation: new Float32Array(buffer, 24, 1),
  edges: [new Float32Array(buffer, 28, 3)],
  boxes: [],
  spheres: [],
  angles: [],
  field: { data: new Uint8Array(buffer, 40, 1), dims: [1, 1, 1], min: [0, 0, 0], cellFt: 1 },
});
const decoded = (): SceneData => ({
  positions: new Float32Array(9),
  metadata: {
    stamp: { epoch: 1, hostDocumentKey: "a", sources: [] },
    elements: [],
    completeness: {
      complete: true,
      deferredCandidates: 0,
      acquisitionLimitedElements: 0,
      limitReason: null,
    },
  } as unknown as SceneData["metadata"],
});

describe("prepared retention under the scene policy", () => {
  it("preserves warm decoded/prepared identity through transient replacement workspace", () => {
    const memory = new SceneMemory({ maxAdmissionBytes: 10000 });
    const scenes = new SceneCache<SceneData & { meshes: SceneMeshes }>(memory);
    const derived = new PreparedCache(memory);
    const data = decoded();
    const meshes = new SceneMeshes(
      data.positions,
      {
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: 1,
        maxY: 1,
        maxZ: 1,
      },
      [],
    );
    const resident = scenes.put("focus", { ...data, meshes });
    const ready = prepared(),
      key = derived.key(meshes, "subject/30");
    derived.put(key, ready);
    const source = resident.acquire();
    const preparation = memory.acquire("prepared", preparedFootprint(ready));
    const displayBacking = new ArrayBuffer(7000),
      displayGpu = {};
    const display = memory.acquire("uploaded", {
      buffers: [data.positions.buffer, ready.positions.buffer, displayBacking],
      gpu: [{ key: displayGpu, bytes: 2000 }],
    });
    expect(memory.snapshot().ownedAndReservedBytes).toBeLessThan(memory.maxAdmissionBytes);
    const workspace = memory.reserve("prepared", { jsBufferBytes: 2000 });
    expect(memory.snapshot().overageBytes).toBeGreaterThan(0);
    expect(memory.snapshot().owners.retained).toBe(2);
    workspace.release();
    // A conservative worker reservation must not erase hot identities then leave an empty cache
    // below the ceiling. These cache aliases share their geometry with active owners.
    expect(memory.snapshot().owners.retained).toBe(2);
    expect(scenes.get("focus")).toBe(resident);
    expect(derived.get(derived.key(scenes.get("focus")!.data.meshes, "subject/30"))).toBe(ready);
    expect(memory.snapshot().overageBytes).toBe(0);
    const stageGpu = {};
    const stage = memory.acquire("staging", { buffers: [displayBacking] });
    stage.update({
      buffers: [displayBacking],
      gpu: [
        { key: displayGpu, bytes: 2000 },
        { key: stageGpu, bytes: 2500 },
      ],
    });
    expect(memory.snapshot().owned.gpuEstimateBytes).toBe(4500);
    expect(memory.snapshot().overageBytes).toBeGreaterThan(0);
    expect(scenes.get("focus")).toBe(resident);
    expect(derived.get(key)).toBe(ready);
    stage.move("uploaded");
    stage.release();
    expect(memory.snapshot().owned.gpuEstimateBytes).toBe(2000);
    expect(memory.snapshot().owners.retained).toBe(2);
    display.release();
    preparation.release();
    source.release();
    scenes.clear();
    derived.clear();
    expect(memory.snapshot().ownedAndReservedBytes).toBe(0);
  });

  it("keys exact immutable mesh identity and structural semantics", () => {
    const cache = new PreparedCache(new SceneMemory());
    const mesh = new SceneMeshes(
      new Float32Array(0),
      { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
      [],
    );
    const other = new SceneMeshes(mesh.positions, mesh.bounds, mesh.instances);
    const key = cache.key(mesh, "subject/30"),
      data = prepared();
    cache.put(key, data);
    expect(cache.get(cache.key(mesh, "subject/30"))).toBe(data);
    expect(cache.get(cache.key(mesh, "context/30"))).toBeUndefined();
    expect(cache.get(cache.key(other, "subject/30"))).toBeUndefined();
    cache.clear();
    expect(cache.memory.snapshot().ownedAndReservedBytes).toBe(0);
  });

  it("charges shared full buffers once and keeps active data when retention yields to admission", () => {
    const data = decoded(),
      admission = sceneAdmissionBytes(data);
    const memory = new SceneMemory({ maxAdmissionBytes: admission * 2 + 10 });
    const derived = new PreparedCache(memory),
      scenes = new SceneCache(memory);
    const ready = prepared(),
      footprint = preparedFootprint(ready);
    const active = memory.acquire("prepared", footprint);
    derived.put("focus", ready);
    derived.put("same-storage", ready, true);
    expect(memory.snapshot().owned.jsBufferBytes).toBe(100);
    expect(memory.snapshot().retention.preparedBytes).toBe(
      100 + footprint.heapBytes! + ("focus".length + "same-storage".length) * 2,
    );
    scenes.put("a", data);
    expect(derived.get("focus")).toBe(ready);
    // The next admitted artifact spends the remaining proxy allowance; no stale headroom callback.
    scenes.put("b", decoded());
    expect(derived.get("focus")).toBeUndefined();
    expect(memory.snapshot().owned.jsBufferBytes).toBe(172);
    active.release();
    scenes.clear();
    expect(memory.snapshot().ownedAndReservedBytes).toBe(0);
  });

  it("optional derivations cannot displace exact focus, but aliases cost no extra storage", () => {
    const memory = new SceneMemory({ maxPreparedBytes: 160 });
    const cache = new PreparedCache(memory),
      focus = prepared();
    cache.put("focus", focus);
    cache.put("alias", focus, true);
    cache.put("context", prepared(), true);
    expect(cache.get("focus")).toBe(focus);
    expect(cache.get("context")).toBeUndefined();
    cache.clear();
  });
});
