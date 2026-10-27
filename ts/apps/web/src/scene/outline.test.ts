import * as THREE from "three";
import { expect, it } from "vite-plus/test";
import { veilOutline } from "./outline";
import { veilUniforms } from "./veil";

it("only a context-tier outline takes the veil factor (line kind), subject stays unveiled", () => {
  const u = veilUniforms();
  const context = veilOutline(new THREE.MeshBasicMaterial(), u, true);
  const subject = veilOutline(new THREE.MeshBasicMaterial(), u, false);
  expect(context.userData.veiled).toBe(true);
  expect(context.customProgramCacheKey()).toContain("|veil-line");
  expect(subject.userData.veiled).toBeUndefined();
  expect(subject.customProgramCacheKey()).not.toContain("veil");
  u.veilField.value.dispose();
});
