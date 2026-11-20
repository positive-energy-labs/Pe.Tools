import { z } from "zod";
import { listSearchSchema } from "./list-search.ts";
import { picturePoseSchemas } from "./slots/picture.ts";
import type { HostRead } from "./host-read.ts";
export { hostRead, type HostRead } from "./host-read.ts";
export { subjectSchema } from "./route-kernel-codecs.ts";
export type * from "./reading-source.ts";

export type FieldRole = "pose" | "query" | "subject" | "stage";
export type FieldHistory = "push" | "replace";

export const field = <S extends z.ZodType, const R extends FieldRole>(
  schema: S,
  initial: z.input<S>,
  role: R,
  url: FieldHistory = "replace",
) => ({ schema, initial, role, url });
/**
 * The kernel's picture pose as Page fields (ADR 0035 rule 1). Each default is the contract schema's own
 * (`picturePoseSchemas`): nothing here states one. `route()` puts `picturePose` on the Page of every route
 * that declares `picture`; a route spreads it into `fields` only to read the pose in its own typed context.
 */
export const poseFields = (s: typeof picturePoseSchemas) => ({
  contextRadiusFt: field(s.contextRadiusFt, s.contextRadiusFt.parse(undefined), "pose", "replace"),
  sceneView: field(s.sceneView, s.sceneView.parse(undefined), "pose", "replace"),
  viewport: field(s.viewport, s.viewport.parse(undefined), "pose", "replace"),
  context: field(s.context, s.context.parse(undefined), "pose", "push"),
  layers: field(s.layers, s.layers.parse(undefined), "pose", "push"),
  encoding: field(s.encoding, s.encoding.parse(undefined), "pose", "push"),
  picture: field(s.picture, s.picture.parse(undefined), "pose", "push"),
});
export const picturePose = poseFields(picturePoseSchemas);

/** Mechanical Page policy; names and their product meaning remain at the call site. */
export const listFields = <const P extends string>(prefix: P) =>
  ({
    [`${prefix}Search`]: searchField(),
    [`${prefix}Sort`]: sortField(),
  }) as { [K in `${P}Search`]: ReturnType<typeof searchField> } & {
    [K in `${P}Sort`]: ReturnType<typeof sortField>;
  };
const searchField = () => field(listSearchSchema, { keywords: "", pills: [], v: 1 }, "query");
const sortField = () => field(z.enum(["", "name"]), "", "query");
export const stageField = <const S extends readonly [string, ...string[]]>(stages: S) =>
  field(z.enum(stages), stages[0], "stage", "push");
export const read = <R extends HostRead, P>(
  handle: R,
  args: (page: P) => unknown = () => ({}),
) => ({ ...handle, args });
