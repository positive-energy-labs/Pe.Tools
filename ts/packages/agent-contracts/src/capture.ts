/**
 * A capture: one taking of `revit.context.view-image`, kept by the host (pages ledger, 2026-10-04:
 * captures are the one picture currency). The blob is stored once per sha; every taking appends
 * one receipt. Host, web and the `capture_view` tool read this file, so they cannot disagree.
 */
import { z } from "zod";

export const VIEW_IMAGE_KEY = "revit.context.view-image";

const shaSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** The one URL a capture's PNG is served at, by any host, for any surface. */
export const captureUrl = (sha: string) => `/captures/${sha}.png`;

export const captureReceiptSchema = z.object({
  id: z.string().min(1),
  sha: shaSchema,
  at: z.iso.datetime(),
  /** Who took it: `web:<path>`, `agent`, `human`, or (phase 2) `page:<slug>`. Attribution only. */
  origin: z.string().regex(/^(?:agent|human|(?:web|page):.+)$/),
  document: z.object({ openId: z.string().optional(), title: z.string().optional() }),
  view: z.object({ id: z.number().optional(), name: z.string().optional() }),
  /** The request's focus, verbatim; null when the whole view was taken. */
  focus: z
    .object({
      elementIds: z.array(z.number()).nullish(),
      selection: z.boolean().optional(),
      scopeBox: z.string().nullish(),
    })
    .nullable(),
  /** Revit's registration (model corners + sha); null when the op refused one (a sheet, no crop). */
  registration: z.looseObject({ imageSha256: shaSchema }).nullable(),
  byteSize: z.number().int().nonnegative(),
  url: z.string(),
});
export type CaptureReceipt = z.infer<typeof captureReceiptSchema>;

export const captureListSchema = z.object({ captures: z.array(captureReceiptSchema) });
