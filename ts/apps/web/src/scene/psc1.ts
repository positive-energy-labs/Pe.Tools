/**
 * PSC1, the scene artifact `revit.detail.space-scene` writes: "PSC1", a u32 metadata length, the
 * metadata JSON, padding to 4 bytes, then float32 xyz positions, nine per triangle, unindexed.
 * Space and ducts fetch the same artifact; both decode it here.
 */
import { SceneMeshes, type SceneInstance } from "./types";

import type { RevitDetailSpaceScene } from "@pe/host-contracts/generated";
import type { Bounds, ScenePrimitive } from "./types";

/** The artifact's metadata, as the op declares it. */
export type Psc1Metadata = RevitDetailSpaceScene.Res.SceneMetadata;
export const SCENE_FORMAT = "space-scene-v3";

const MAGIC = 0x31435350; // "PSC1" little-endian
const MAX_TRIANGLES = 3_000_000;
const validBounds = (b: Bounds) =>
  b &&
  [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ].every(Number.isFinite) &&
  b.minX <= b.maxX &&
  b.minY <= b.maxY &&
  b.minZ <= b.maxZ;
const vector = (v: number[]) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
function primitiveOf(e: Psc1Metadata["elements"][number]): ScenePrimitive | undefined {
  if (e.representation === "mesh") {
    if (e.run != null) throw Error("Invalid mesh run metadata");
    return undefined;
  }
  if (e.representation === "box" && e.run == null) return { kind: "box", bounds: e.bounds };
  const r = e.run;
  if (
    e.representation !== "run" ||
    !r ||
    !vector(r.start) ||
    !vector(r.end) ||
    !vector(r.crossSectionXAxis)
  )
    throw Error("Invalid scene primitive");
  const axis = r.crossSectionXAxis,
    delta = r.end.map((n, i) => n - r.start[i]!);
  const length = Math.hypot(...delta),
    axisLength = Math.hypot(...axis);
  const positive = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n > 0;
  if (
    length <= 1e-8 ||
    Math.abs(axisLength - 1) > 1e-4 ||
    Math.abs(delta.reduce((n, v, i) => n + v * axis[i]!, 0) / length) > 1e-4 ||
    (r.shape === "round"
      ? !positive(r.diameterFt) || r.widthFt != null || r.heightFt != null
      : !["rectangular", "oval"].includes(r.shape) ||
        !positive(r.widthFt) ||
        !positive(r.heightFt) ||
        r.diameterFt != null)
  )
    throw Error("Invalid scene run frame or dimensions");
  return { kind: "run", bounds: e.bounds, run: r };
}

const elementKey = (h: Psc1Metadata["elements"][number]["handle"]) =>
  JSON.stringify([h.documentKey, h.linkInstanceId ?? null, h.uniqueId]);

export function decodeScene(buffer: ArrayBuffer): { metadata: Psc1Metadata; meshes: SceneMeshes } {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8 || view.getUint32(0, true) !== MAGIC)
    throw Error("Not a PSC1 scene artifact");
  const length = view.getUint32(4, true),
    offset = Math.ceil((8 + length) / 4) * 4;
  if (offset > buffer.byteLength) throw Error("Truncated scene metadata");
  const metadata = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 8, length)),
  ) as Psc1Metadata;
  const completeness = metadata.completeness;
  if (metadata.format !== SCENE_FORMAT || !completeness)
    throw Error("Scene capture is outdated. Reload the Revit payload and refresh the scene.");
  if (
    typeof completeness.complete !== "boolean" ||
    (completeness.deferredCandidates !== null &&
      (typeof completeness.deferredCandidates !== "number" ||
        !Number.isSafeInteger(completeness.deferredCandidates) ||
        completeness.deferredCandidates < 0)) ||
    !Number.isSafeInteger(completeness.acquisitionLimitedElements) ||
    completeness.acquisitionLimitedElements < 0 ||
    (completeness.limitReason !== null && typeof completeness.limitReason !== "string")
  )
    throw Error("Invalid scene completeness metadata");
  if (
    metadata.stamp?.frame !== "host-internal-ft" ||
    !Number.isInteger(metadata.triangles) ||
    metadata.triangles < 0 ||
    !validBounds(metadata.bounds) ||
    metadata.triangles > MAX_TRIANGLES ||
    buffer.byteLength - offset !== metadata.triangles * 36
  )
    throw Error("Invalid scene frame or vertex budget");
  let nextVertex = 0;
  const instances = metadata.elements.map((e): SceneInstance => {
    if (!validBounds(e.bounds)) throw Error("Invalid element bounds");
    const primitive = primitiveOf(e);
    if (
      !Number.isInteger(e.firstVertex) ||
      !Number.isInteger(e.vertexCount) ||
      e.firstVertex !== nextVertex ||
      (primitive ? e.vertexCount !== 0 : e.vertexCount <= 0) ||
      e.vertexCount % 3 !== 0 ||
      e.firstVertex + e.vertexCount > metadata.triangles * 3
    )
      throw Error("Invalid element vertex range");
    nextVertex += e.vertexCount;
    const categoryId = e.categoryId ?? null;
    if (categoryId !== null && !Number.isSafeInteger(categoryId))
      throw Error("Invalid scene category id");
    const h = e.handle,
      link = h.linkInstanceId ?? null;
    return {
      key: elementKey(h),
      // A linked element's id means nothing to the host document's selection.
      revitId: link === null ? h.elementId : null,
      documentKey: h.documentKey,
      linkInstanceId: link,
      uniqueId: h.uniqueId,
      categoryId,
      category: h.category,
      focus: e.focus,
      firstVertex: e.firstVertex,
      vertexCount: e.vertexCount,
      ...(primitive ? { primitive } : {}),
    };
  });
  if (nextVertex !== metadata.triangles * 3) throw Error("Incomplete element vertex ranges");
  return {
    metadata,
    meshes: new SceneMeshes(new Float32Array(buffer, offset), metadata.bounds, instances),
  };
}
