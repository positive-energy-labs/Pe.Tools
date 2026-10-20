/**
 * The picture's two page keys, read defensively: `page.picture` (which picture is the main one,
 * the model or the schematic; the other rides the corner) and `page.camera` (a preset of the
 * model's globe camera). The manifest owns the keys' schema; a page without them is the model
 * from the iso preset, so this compiles and behaves before the keys land.
 */
import type { DuctsPage } from "./manifest";

export type Picture = "model" | "schematic";
export type CameraPreset = "iso" | "plan";

export const pictureOf = (page: object): Picture =>
  (page as { picture?: string }).picture === "schematic" ? "schematic" : "model";

export const cameraOf = (page: object): CameraPreset =>
  (page as { camera?: string }).camera === "plan" ? "plan" : "iso";

/** A `setPage` patch for the picture keys; the cast is the one place the keys' absence is tolerated. */
export const pictureKeys = (patch: { picture?: Picture; camera?: CameraPreset }) =>
  patch as unknown as Partial<DuctsPage>;
