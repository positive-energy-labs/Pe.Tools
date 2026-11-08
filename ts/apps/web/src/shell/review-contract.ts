import { z } from "zod";
/** Host-owned: what a ModelWrite commit borrows on a workshared central (C# WorksharingDisclosure). */
export const worksharingSchema = z.object({
  cloud: z.boolean(),
  elements: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      status: z.enum(["borrows", "owned", "blocked"]),
      owner: z.string().nullish(),
    }),
  ),
  creates: z.array(z.string()),
});
export type Worksharing = z.infer<typeof worksharingSchema>;
/** Any preview envelope (`response`, `value`, or the bare result) may carry `worksharing`. */
export const worksharingOf = (evidence: unknown): Worksharing | null => {
  const e = evidence as {
    response?: { worksharing?: unknown };
    value?: { worksharing?: unknown };
    worksharing?: unknown;
  } | null;
  const parsed = worksharingSchema.safeParse(
    e?.response?.worksharing ?? e?.value?.worksharing ?? e?.worksharing,
  );
  return parsed.success ? parsed.data : null;
};
export interface VerbPresentation {
  readonly sentence: string;
  readonly rows: readonly string[];
  /** Set by the kernel from the preview evidence; a presenter never computes it. */
  readonly worksharing?: Worksharing | null;
  /** Admitted Page state for a picture or other route view of the review. */
  readonly page?: Record<string, unknown>;
}
