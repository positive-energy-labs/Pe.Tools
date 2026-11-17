/**
 * `state\homes.json`: the homes a person chose for this machine in Settings (ADR 0037 rule 2 as built:
 * the product, not an environment variable, is where a coworker sets a home). Browser-safe, so the
 * route contract and the resolver share it. `project` is absent by design: a project home is named by
 * the model's pointer, never by the machine. The C# twin reads the same two fields
 * (`ProductPathing.HomesConfig`).
 */
import { z } from "zod";

const absolutePath = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine(
    (path) => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/"),
    "an absolute path",
  );

export const homesConfigSchema = z.strictObject({
  /** The firm home itself (the folder holding `pe-home.json` of tier firm). Still needs its marker. */
  firm: absolutePath.optional(),
  /** The user home. Needs no marker: the user home always exists. */
  user: absolutePath.optional(),
});
export type HomesConfig = z.infer<typeof homesConfigSchema>;

/** How a home was found: env override (dev/test isolation), this machine's homes.json, or the default. */
export const homeFoundValues = ["documents", "override", "config", "pointer", "probe"] as const;

/** What Settings reads and what a write answers: the file, and the homes as resolved after it. */
export const homesStatusSchema = z.strictObject({
  config: homesConfigSchema,
  /** Why the file on disk was not used, when it does not parse; null when it parses or is absent. */
  configError: z.string().nullable(),
  homes: z.array(
    z.strictObject({
      tier: z.enum(["user", "project", "firm"]),
      path: z.string(),
      found: z.enum(homeFoundValues),
    }),
  ),
  firmNotice: z.string().nullable(),
});
export type HomesStatus = z.infer<typeof homesStatusSchema>;
