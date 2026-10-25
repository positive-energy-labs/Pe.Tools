/**
 * PSC1, the scene artifact `revit.detail.space-scene` writes: "PSC1", a u32 metadata length, the
 * metadata JSON, padding to 4 bytes, then float32 xyz positions, nine per triangle, unindexed.
 * Space and ducts fetch the same artifact; both decode it here.
 */
import { SceneMeshes, type SceneInstance } from "./types";

import type { RevitDetailSpaceScene } from "@pe/host-contracts/generated";

/** The artifact's metadata, as the op declares it. */
export type Psc1Metadata = RevitDetailSpaceScene.Res.SceneMetadata;

const MAGIC = 0x31435350; // "PSC1" little-endian
const MAX_TRIANGLES = 3_000_000;

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
  if (
    metadata.format !== "space-scene-v1" ||
    metadata.stamp?.frame !== "host-internal-ft" ||
    !Number.isInteger(metadata.triangles) ||
    metadata.triangles < 1 ||
    metadata.triangles > MAX_TRIANGLES ||
    buffer.byteLength - offset !== metadata.triangles * 36
  )
    throw Error("Invalid scene frame or vertex budget");
  let nextVertex = 0;
  const instances = metadata.elements.map((e): SceneInstance => {
    if (
      !Number.isInteger(e.firstVertex) ||
      !Number.isInteger(e.vertexCount) ||
      e.firstVertex !== nextVertex ||
      e.vertexCount <= 0 ||
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
    };
  });
  if (nextVertex !== metadata.triangles * 3) throw Error("Incomplete element vertex ranges");
  return {
    metadata,
    meshes: new SceneMeshes(new Float32Array(buffer, offset), metadata.bounds, instances),
  };
}
