import { z } from "zod";
import { INVALID, type Codec } from "./page-keys.ts";

const finite = z.number().finite();
const bounds = z
  .object({
    minX: finite,
    minY: finite,
    minZ: finite,
    maxX: finite,
    maxY: finite,
    maxZ: finite,
  })
  .refine(
    (b) => b.minX < b.maxX && b.minY < b.maxY && b.minZ < b.maxZ,
    "Section faces must enclose a volume",
  );

/** Camera-independent section coordinates in host internal feet. */
export const sceneSectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("box"), bounds }),
  z.object({
    kind: z.literal("plane"),
    axis: z.enum(["x", "y", "z"]),
    offset: finite,
    keep: z.enum(["below", "above"]),
  }),
]);
export const SCENE_PRESETS = [
  "all",
  "walls",
  "structural",
  "no-lighting",
  "nearby-structure",
  "subject",
] as const;
export const sceneViewSchema = z.object({
  preset: z.enum(SCENE_PRESETS).default("all"),
  section: sceneSectionSchema.nullable().default(null),
});
export type SceneSection = z.infer<typeof sceneSectionSchema>;
export type SceneView = z.infer<typeof sceneViewSchema>;
export const sceneViewCodec: Codec<SceneView> = {
  encode: (value) => JSON.stringify(value),
  decode: (text) => {
    try {
      return JSON.parse(text) as SceneView;
    } catch {
      return INVALID;
    }
  },
};
