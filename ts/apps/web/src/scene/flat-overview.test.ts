import * as THREE from "three";
import { expect, test } from "vite-plus/test";
import fixture from "./fixtures/chadds-flat-overview.json";
import { decodeScene } from "./psc1";
import { primitiveEdges, instancePositions } from "./primitives";
import { prepareGeometry } from "./prepare-geometry";
import { prepareFaceBatches } from "./face-batches";
import { createFacePicker } from "./picking";

// Raw PSC1 wire inputs, not an assertion into production metadata types.
function artifact(metadata: unknown) {
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const offset = Math.ceil((8 + json.length) / 4) * 4;
  const buffer = new ArrayBuffer(offset);
  const view = new DataView(buffer);
  view.setUint32(0, 0x31435350, true);
  view.setUint32(4, json.length, true);
  new Uint8Array(buffer, 8).set(json);
  return buffer;
}

test("the ke277 MUAS-1 box remains drawable and pickable beside its real planar insulation context", async () => {
  const { meshes } = decodeScene(artifact(fixture.metadata));
  const fan = meshes.instances.find((i) => i.revitId === 14577391)!;
  const insulation = meshes.instances.find((i) => i.revitId === 14492245)!;
  expect(fan.focus).toBe(true);
  expect(insulation.focus).toBe(false);
  const primitive = insulation.primitive;
  if (primitive?.kind !== "oriented-box") throw Error("Expected the recorded bounds proxy");
  expect(primitive.box.halfSize).toEqual([0.4583282470703125, 0, 0.45833349227905273]);
  expect(Array.from(primitiveEdges(primitive, 30)).every(Number.isFinite)).toBe(true);
  const positions = instancePositions(meshes, insulation);
  for (let n = 1; n < positions.length; n += 3) expect(positions[n]).toBe(676.9408569335938); // no invented thickness
  const ready = prepareGeometry({
    positions: meshes.positions,
    bounds: meshes.bounds,
    instances: meshes.instances,
    cuts: meshes.cuts,
    subjects: meshes.instances.map((i) => i.focus),
    angles: meshes.instances.map(() => 30),
  });
  const material = new THREE.MeshLambertMaterial();
  const batches = await prepareFaceBatches(
    meshes,
    ready,
    meshes.instances.map((i) => ({ tier: i.focus ? "subject" : "context" })),
    material,
    undefined,
    () => {},
  );
  try {
    for (const part of batches.parts) part.mesh.updateMatrixWorld(true);
    const pick = createFacePicker(batches, (i) => (i.focus ? 1 : 0));
    const hit = pick(
      new THREE.Ray(new THREE.Vector3(490, 676.4, 13.3), new THREE.Vector3(-1, 0, 0)),
    );
    expect(hit?.instance.revitId).toBe(14577391);
    expect(hit?.point.every(Number.isFinite)).toBe(true);
  } finally {
    batches.disposeExcept();
    material.dispose();
  }
});

test("the planar-bounds exception does not admit negative dimensions, exact zero-volume boxes or inconsistent bounds", () => {
  for (const frame of ["symbol", "triangles", "link"]) {
    const metadata = structuredClone(fixture.metadata);
    metadata.elements[1]!.orientedBox.frame = frame;
    expect(() => decodeScene(artifact(metadata))).toThrow("Invalid oriented box dimensions");
  }
  const negative = structuredClone(fixture.metadata);
  negative.elements[1]!.orientedBox.halfSize[1] = -0.01;
  expect(() => decodeScene(artifact(negative))).toThrow("Invalid oriented box dimensions");
  const inconsistent = structuredClone(fixture.metadata);
  inconsistent.elements[1]!.orientedBox.center[1]! += 1;
  expect(() => decodeScene(artifact(inconsistent))).toThrow("bounds disagree");
});
