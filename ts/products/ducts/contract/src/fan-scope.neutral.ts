import { z } from "zod";
export const fanScopeSchema = z.object({
  uniqueId: z.string().min(1),
  portIndex: z.number().int().nonnegative(),
});
export type FanScope = z.infer<typeof fanScopeSchema>;
/** A port walk's segments carry single canonical system names; equipment labels may combine names. */
export const fanSystems = (
  walk: { segments: readonly { systemName?: string | null; reason?: string | null }[] },
  roster: readonly { name: string }[],
) =>
  roster
    .filter((system) =>
      walk.segments.some(
        (segment) => segment.reason === "walked" && segment.systemName === system.name,
      ),
    )
    .map((system) => system.name);
