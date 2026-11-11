import type { z } from "zod";
import type { Immutable } from "../route-kernel-data.ts";
import { picturePoseSchemas } from "../slots/picture.ts";

type Pose = typeof picturePoseSchemas;
/** The page slice a `Picture` (web `scene/picture`) reads and writes: the kernel's pose, plus the picked element and inbox row the body supplies from the selection. */
export type PicturePage<_L extends string = string, _F extends string = string> = {
  /** `picture` is `model` or the content's flat key; any other value draws the model. */
  [K in keyof Pose]: Immutable<z.output<Pose[K]>>;
} & {
  /** The picked subject's key; empty = none. */
  selected: string;
  /** The picked inbox row or issue; empty = none. */
  issue: string;
};

/** The /ducts picture's layer names (the fan sheet draws the same network). Context is the pose's `context`, never a layer. */
export const DUCTS_LAYERS = [
  "meshes",
  "system-colours",
  "stub-labels",
  "centrelines",
  "no-run",
  "labels",
  "findings",
] as const;
