import { z } from "zod";

export const podModelSchema = z.strictObject({
  title: z.string().trim().min(1),
  probes: z
    .array(
      z.strictObject({
        elementId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        uniqueId: z.string().trim().min(1),
      }),
    )
    .min(1),
});
export type PodModel = z.infer<typeof podModelSchema>;

const modelDetailSchema = z.object({
  documentTitle: z.string().optional(),
  entries: z
    .array(z.object({ elementId: z.number().int(), elementUniqueId: z.string() }))
    .optional(),
});

/** Missing, duplicate or changed identities cannot establish that this is the authored model. */
export function wrongPodModel(model: PodModel, detail: unknown): string | null {
  const data = modelDetailSchema.safeParse(detail).data;
  const matches = model.probes.every((probe) => {
    const entries = data?.entries?.filter((entry) => entry.elementId === probe.elementId) ?? [];
    return entries.length === 1 && entries[0].elementUniqueId === probe.uniqueId;
  });
  return matches
    ? null
    : `this Pod is for ${model.title}; the bound document is ${data?.documentTitle ?? "unknown"}`;
}
