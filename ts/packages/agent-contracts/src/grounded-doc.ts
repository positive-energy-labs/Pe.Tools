import { z } from "zod";

export const docBBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export const groundedBlockSchema = z.object({
  id: z.string(),
  page: z.number(),
  kind: z.string(),
  md: z.string(),
  bboxes: z.array(docBBoxSchema),
});
export const parsedPageSchema = z.object({
  page: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  screenshotUrl: z.string().nullable(),
  markdown: z.string(),
});
export const docImageSchema = z.object({
  id: z.string(),
  page: z.number(),
  category: z.enum(["embedded", "layout"]),
  url: z.string(),
  bbox: docBBoxSchema,
});
/** Persisted assets are paths relative to the spec JSON. Transport resolves them to pod URLs. */
export const parsedDocViewSchema = z.object({
  jobId: z.string(),
  fileName: z.string(),
  pages: z.array(parsedPageSchema),
  blocks: z.array(groundedBlockSchema),
  images: z.array(docImageSchema),
});
export type DocBBox = z.infer<typeof docBBoxSchema>;
export type GroundedBlock = z.infer<typeof groundedBlockSchema>;
export type ParsedPage = z.infer<typeof parsedPageSchema>;
export type DocImage = z.infer<typeof docImageSchema>;
export type ParsedDocView = z.infer<typeof parsedDocViewSchema>;
