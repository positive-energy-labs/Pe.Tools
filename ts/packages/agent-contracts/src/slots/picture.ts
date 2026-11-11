import { z } from "zod";
import { subjectRefCodeSchema, type SubjectRefCode } from "../subject-ref.ts";
import { viewportKey, viewportSchema } from "../page-keys.ts";
import { sceneViewSchema } from "../scene-view.ts";

/*
 * The picture slot (ADR 0035 rules 1 and 2). A scope is a SubjectRef set, a box or a prism with a
 * frame; it is a scope, never an identity. Marks are a closed set the kernel draws on a subject's
 * geometry or at model coordinates. The kernel resolves every SubjectRef to geometry itself: a
 * route declares no translator, no element-key regex and no selection-string bridge.
 */

/** Model feet, z up (the scene's host-internal frame). */
export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];
/** A plane frame: `z` is `x × y`. */
export interface Frame {
  readonly origin: Vec3;
  readonly x: Vec3;
  readonly y: Vec3;
}

export type PictureScope =
  | { readonly kind: "subjects"; readonly refs: readonly SubjectRefCode[] }
  | { readonly kind: "box"; readonly min: Vec3; readonly max: Vec3 }
  /** A polygon in the frame's plane, extruded along the frame's `z` between `depth[0]` and `depth[1]`. */
  | { readonly kind: "prism"; readonly frame: Frame; readonly polygon: readonly Vec2[]; readonly depth: Vec2 };

/** Closed. From the illustrations the ducts cases draw: ring, outline, bar, volume, plus a label. */
export const MARK_KINDS = ["ring", "outline", "bar", "volume", "label"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

/** Where a mark sits: on a subject's geometry (the kernel resolves it), or at model coordinates. */
export type MarkAt =
  | SubjectRefCode
  | { readonly point: Vec3 }
  | { readonly from: Vec3; readonly to: Vec3 };

export interface Mark {
  readonly kind: MarkKind;
  readonly at: MarkAt;
  /** A design token (`viz-1`) or six-digit hex; the kernel's inks resolve it. */
  readonly ink?: string;
  readonly says?: string;
}

/**
 * The declaration. `scope: "subject"` is the route subject; a function derives one from context.
 * Method signatures, not function properties: a route's concrete context must assign to the
 * kernel's `TypedRoute` (ADR 0035 rule 4: inferred, never generated), which needs bivariance here.
 */
export interface PictureSlot<C = unknown> {
  readonly scope: "subject" | { derive(ctx: C): PictureScope };
  marks?(ctx: C): readonly Mark[];
}

const vec3 = z.tuple([z.number(), z.number(), z.number()]).readonly();
const vec2 = z.tuple([z.number(), z.number()]).readonly();
export const pictureScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("subjects"), refs: z.array(subjectRefCodeSchema).readonly() }),
  z.strictObject({ kind: z.literal("box"), min: vec3, max: vec3 }),
  z.strictObject({
    kind: z.literal("prism"),
    frame: z.strictObject({ origin: vec3, x: vec3, y: vec3 }),
    polygon: z.array(vec2).min(3).readonly(),
    depth: vec2,
  }),
]);
export const markSchema = z.strictObject({
  kind: z.enum(MARK_KINDS),
  at: z.union([
    subjectRefCodeSchema,
    z.strictObject({ point: vec3 }),
    z.strictObject({ from: vec3, to: vec3 }),
  ]),
  ink: z.string().min(1).optional(),
  says: z.string().optional(),
});
/** The data projection a Pod decodes at the boundary: the subject or a derived scope, and which mark kinds it draws. */
export const pictureSlotDataSchema = z.strictObject({
  scope: z.enum(["subject", "derived"]),
  marks: z.array(z.enum(MARK_KINDS)).readonly(),
});
export type PictureSlotData = z.output<typeof pictureSlotDataSchema>;
/** The declaration's data projection. ponytail: `marks` names the whole closed set when the route draws any, since `marks(ctx)` is a function; narrow it when a reader needs the kinds. */
export const pictureSlotData = (slot: PictureSlot<never>): PictureSlotData => ({
  scope: slot.scope === "subject" ? "subject" : "derived",
  marks: slot.marks ? MARK_KINDS : [],
});

/** How context around the scope draws: off, as lines, or as glass surfaces. One key; no layer aliases it. */
export const PICTURE_CONTEXT = ["off", "lines", "glass"] as const;
/**
 * The pose the kernel owns for every picture: the camera, the section, the context reach and how it
 * draws, the layers on, the encoding and the picture mode. `layers: "default"` is the picture's own
 * default set (its layer options not marked off); `encoding: ""` is its own default encoding.
 */
export const picturePoseSchemas = {
  contextRadiusFt: z.number().min(0).max(64).default(10),
  sceneView: sceneViewSchema.default({ preset: "all", section: null }),
  viewport: viewportKey(viewportSchema),
  context: z.enum(PICTURE_CONTEXT).default("glass"),
  layers: z.union([z.array(z.string().min(1).max(200)).max(64), z.literal("default")]).default("default"),
  encoding: z.string().max(200).default(""),
  picture: z.string().min(1).max(200).default("model"),
};
