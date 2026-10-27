import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { contextPickable, createMeshPicker } from "./picking";
import type { Pick, SceneInstance } from "./types";

function fixture() {
  const batch = new THREE.BatchedMesh(
    3,
    108,
    0,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  const byId: SceneInstance[] = [];
  for (let id = 0; id < 3; id++) {
    const geometry = new THREE.BoxGeometry(2, 2, 1).toNonIndexed();
    geometry.translate(0, 0, id * 3);
    batch.addInstance(batch.addGeometry(geometry));
    geometry.dispose();
    byId.push({
      key: String(id),
      revitId: id === 1 ? null : id,
      documentKey: "doc",
      linkInstanceId: id === 1 ? 42 : null,
      uniqueId: String(id),
      category: "Duct",
      categoryId: null,
      focus: true,
      firstVertex: id * 36,
      vertexCount: 36,
    });
  }
  batch.position.set(803.405, 318.519, 7.836);
  batch.updateMatrixWorld(true);
  return { batch, byId, pick: createMeshPicker(batch, byId) };
}

describe("nearest kept mesh picking", () => {
  it("picks a drawn foreground subject through context, respecting cuts and hidden subjects", () => {
    const { batch, byId } = fixture();
    const ray = new THREE.Ray(
      batch.position.clone().add(new THREE.Vector3(0, 0, 10)),
      new THREE.Vector3(0, 0, -1),
    );
    // The nearest box (2) is context, while boxes 0 and 1 are drawn above context.
    const pick = createMeshPicker(batch, byId, (i) => (i.key === "2" ? 0 : 1));
    expect(pick(ray)?.instance).toBe(byId[1]);
    batch.setVisibleAt(1, false);
    expect(pick(ray)?.instance).toBe(byId[0]);
    expect(pick(ray, (p) => p.instance.key !== "0")?.instance).toBe(byId[2]);
    batch.setVisibleAt(0, false);
    expect(pick(ray)?.instance).toBe(byId[2]);
    expect(pick(ray, () => false)).toBeNull();
    batch.dispose();
  });
  it("matches Three through hidden elements, back faces, cuts, inside boxes and world rebasing", () => {
    const { batch, byId, pick } = fixture();
    const raycaster = new THREE.Raycaster();
    const clips: Array<((p: Pick) => boolean) | undefined> = [
      undefined,
      (p) => p.point[2] < 12,
      (p) => p.point[0] < 803.405,
      () => false,
    ];
    for (const hidden of [false, true]) {
      batch.setVisibleAt(2, !hidden);
      for (const direction of [1, -1]) {
        for (const z of [-2, 3, 10]) {
          for (const x of [-2, -0.5, 0, 0.5, 2]) {
            raycaster.ray.set(
              batch.position.clone().add(new THREE.Vector3(x, 0.2, z)),
              new THREE.Vector3(0, 0, direction),
            );
            for (const clip of clips) {
              const expected =
                raycaster
                  .intersectObject(batch)
                  .map((h) => ({ instance: byId[h.batchId!]!, point: h.point.toArray() }))
                  .find((h) => !clip || clip(h)) ?? null;
              const actual = pick(raycaster.ray, clip);
              expect(actual?.instance).toBe(expected?.instance);
              if (expected)
                actual!.point.forEach((v, i) => expect(v).toBeCloseTo(expected.point[i]!, 9));
              else expect(actual).toBeNull();
            }
          }
        }
      }
    }
    batch.dispose();
  });
  it("keeps searching behind a cut front face in the same element", () => {
    const { batch, pick, byId } = fixture();
    const ray = new THREE.Ray(
      batch.position.clone().add(new THREE.Vector3(0, 0, 10)),
      new THREE.Vector3(0, 0, -1),
    );
    const hit = pick(ray, (p) => p.point[2] < batch.position.z + 6);
    expect(hit?.instance).toBe(byId[2]);
    expect(hit?.point[2]).toBeCloseTo(batch.position.z + 5.5, 9);
    batch.dispose();
  });
});

describe("context pick rule", () => {
  const look = { near: 1, far: 10, curve: 2, fill: 1 };
  it("picks a context pane only in glass mode, inside the far edge, where it is drawn", () => {
    expect(contextPickable("glass", 0.5, look)).toBe(true);
    expect(contextPickable("lines", 0.5, look)).toBe(false);
    expect(contextPickable("off", 0.5, look)).toBe(false);
    expect(contextPickable("glass", 10, look)).toBe(false);
    // Linear falloff with curve 2: just inside the far edge the alpha is ~0 and must not hover.
    expect(contextPickable("glass", 9.9, look)).toBe(false);
  });
});
